import { redirect } from "next/navigation";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Coin Check was removed. Old links keep working: `/app/check?q=<contract>` opens that coin's page (the token page
 * resolves contract addresses), anything else goes to Early Coins.
 */
export default async function CheckPage({ searchParams }: PageProps<"/app/check">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  redirect(ADDRESS.test(q) ? `/app/token/solana/${q}` : "/app");
}
