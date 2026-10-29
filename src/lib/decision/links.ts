import { CHAINS } from "@/lib/chains";
import type { GateItem } from "./verdict";

export interface EvidenceLink {
  label: string;
  href: string;
  /** Opens a block explorer (new tab) rather than a SOLME page. */
  external: boolean;
}

export interface EvidenceRefs {
  mint: string;
  /** Main DEX pool the trades and depth were read from. */
  pair: string | null;
  /** The creator's wallet (holder report or launchpad record). */
  dev: string | null;
  /** Launchpad creator with a SOLME developer profile. */
  creator: string | null;
  /** Recorded sales by the creator, newest first. */
  devSells: { signature: string; pct: number | null }[];
  /** Funders shared by groups of top holders, largest group first. */
  clusters: { funder: string; wallets: number }[];
}

const MAX_TX = 3;

/**
 * Pure: where to verify each Coin Check finding on-chain. Explorer pages for the token (authorities, transfers,
 * holders), the pool (liquidity, trades), the dev wallet, each recorded dev sale and each shared funder. The sell
 * test is a simulation and is never sent, so it has no transaction to link.
 */
export function evidenceLinks(r: EvidenceRefs): Partial<Record<GateItem["key"], EvidenceLink[]>> {
  const sol = CHAINS.solana;
  const ext = (label: string, href: string): EvidenceLink => ({ label, href, external: true });
  const token = ext("Token on Solscan", `https://solscan.io/token/${r.mint}`);
  const holders = ext("Holders on Solscan", `https://solscan.io/token/${r.mint}#holders`);
  const pool = r.pair ? [ext("Pool and its trades", sol.explorerAddress(r.pair))] : [];
  const devWallet = r.dev ? [ext("Dev wallet", sol.explorerAddress(r.dev))] : [];
  const sales = r.devSells.slice(0, MAX_TX).map((s, i) => ext(`Dev sale ${i + 1}${s.pct ? ` (${s.pct.toFixed(1)}%)` : ""}`, sol.explorerTx(s.signature)));
  const funders = r.clusters.slice(0, MAX_TX).map((c) => ext(`Shared funder (${c.wallets} wallets)`, sol.explorerAddress(c.funder)));
  return {
    contract: [token],
    transfer: [token],
    concentration: [holders],
    bundle: [holders],
    snipers: [holders],
    dev: devWallet,
    devsold: sales.length ? sales : devWallet,
    devrecord: r.creator ? [{ label: "Developer profile", href: `/app/smart-dev/${r.creator}`, external: false }] : devWallet,
    insiders: [...funders, ...devWallet],
    liquidity: pool,
    pool,
    exit: pool,
    trading: pool,
    flow: pool,
  };
}
