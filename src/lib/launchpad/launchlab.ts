import { readableLabel } from "@/lib/format";
import { getAccounts, getTransaction } from "@/lib/providers/helius-history";
import { decodeLaunchLabPool, LAUNCHLAB_PROGRAM, parseLaunchLabInitArgs } from "./pump";

export interface LaunchLabLaunch {
  mint: string;
  creator: string;
  poolAccount: string;
  quoteMint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  createdAt: number | null;
}

/**
 * Reads a LetsBonk (Raydium LaunchLab) launch from its create transaction: the pool account (owned by the
 * LaunchLab program, decoded for the real base mint, quote mint and creator) and the name/symbol/uri args.
 * Costs 2 Helius credits. Returns null if the transaction is not available or holds no LaunchLab pool.
 */
export async function resolveLaunchLabCreate(signature: string): Promise<LaunchLabLaunch | null> {
  const tx = await getTransaction(signature);
  if (!tx || tx.meta?.err) return null;
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const programIdx = keys.indexOf(LAUNCHLAB_PROGRAM);
  if (programIdx < 0) return null;

  const accounts = await getAccounts([...new Set(keys)]);
  for (const [address, a] of accounts) {
    if (a?.owner !== LAUNCHLAB_PROGRAM) continue;
    const pool = decodeLaunchLabPool(a.data);
    if (!pool) continue;
    const args = tx.transaction.message.instructions
      .filter((ix) => ix.programIdIndex === programIdx)
      .map((ix) => parseLaunchLabInitArgs(ix.data))
      .find((x) => x !== null);
    return {
      mint: pool.baseMint,
      creator: pool.creator,
      poolAccount: address,
      quoteMint: pool.quoteMint,
      name: readableLabel(args?.name, pool.baseMint),
      symbol: readableLabel(args?.symbol, pool.baseMint),
      uri: args?.uri ?? null,
      createdAt: tx.blockTime,
    };
  }
  return null;
}
