import { isChainId } from "@/lib/chains";
import { query } from "@/lib/db";
import { errorMessage, logger } from "@/lib/log";
import { walletProviderFor } from "@/lib/providers/wallets";

const log = logger("wallets");

/** Pulls recent transactions for wallets that someone tracks (or that are public, documented profiles). */
export async function syncWallets(limit = 25): Promise<{ synced: number; skipped: number }> {
  const wallets = await query<{ id: string; chain: string; address: string }>(
    `SELECT w.id, w.chain, w.address FROM wallet_profiles w
      WHERE w.is_public OR EXISTS (SELECT 1 FROM user_tracked_wallets t WHERE t.wallet_id = w.id)
      ORDER BY w.last_synced_at NULLS FIRST LIMIT $1`,
    [limit],
  );
  let synced = 0;
  let skipped = 0;
  for (const w of wallets) {
    if (!isChainId(w.chain)) continue;
    const provider = walletProviderFor(w.chain);
    if (!provider || !provider.configured()) {
      skipped++;
      continue;
    }
    try {
      const txs = await provider.getTransactions(w.chain, w.address, 50);
      for (const t of txs) {
        await query(
          `INSERT INTO wallet_transactions (wallet_id, chain, tx_hash, block_time, direction, token_address, token_symbol, amount, amount_usd, counterparty, provider, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (chain, tx_hash, wallet_id, token_address, direction) DO NOTHING`,
          [w.id, w.chain, t.txHash, t.blockTime, t.direction, t.tokenAddress, t.tokenSymbol, t.amount, t.amountUsd, t.counterparty, provider.name, t.raw ? JSON.stringify(t.raw) : null],
        );
      }
      await query("UPDATE wallet_profiles SET last_synced_at = now() WHERE id = $1", [w.id]);
      synced++;
    } catch (err) {
      log.warn("Wallet sync failed", { wallet: w.id, error: errorMessage(err) });
    }
  }
  return { synced, skipped };
}
