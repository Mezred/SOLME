import { getEntitlements } from "@/lib/billing/entitlements";
import { CHAINS } from "@/lib/chains";
import { searchTokens } from "@/lib/data/tokens";
import { api, enforceRateLimit, ok, requireUser } from "@/lib/http";
import { lookupAddress } from "@/lib/ingestion/lookup";

const ADDRESS = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export const GET = api(async (req) => {
  const user = await requireUser();
  await enforceRateLimit(`search:${user.id}`, 60, 60);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return ok({ results: [] });
  const ent = await getEntitlements(user.id);
  let results = await searchTokens(q, ent.features.chains);
  if (results.length === 0 && ADDRESS.test(q)) {
    // Unknown address: fetch it live from providers (rate-limited, shared cache).
    await enforceRateLimit(`lookup:${user.id}`, 10, 300);
    const chains = ent.features.chains.filter((c) => (q.startsWith("0x") ? CHAINS[c].kind === "evm" : CHAINS[c].kind === "solana"));
    await lookupAddress(q, chains);
    results = await searchTokens(q, ent.features.chains);
  }
  return ok({ results });
});
