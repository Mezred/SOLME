import { getEntitlements } from "@/lib/billing/entitlements";
import { searchTokens } from "@/lib/data/tokens";
import { api, enforceRateLimit, ok, requireUser } from "@/lib/http";
import { lookupAddress } from "@/lib/ingestion/lookup";
import { dexscreener } from "@/lib/providers/dexscreener";
import { rateLimit } from "@/lib/ratelimit";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
    await lookupAddress(q, ent.features.chains, { explicit: true });
    results = await searchTokens(q, ent.features.chains);
  } else if (results.length === 0 && q.length >= 3 && (await rateLimit(`symsearch:${user.id}`, 20, 300)).allowed) {
    // Unknown symbol or name: ask DexScreener and track the most liquid matches on the user's chains, so a
    // well-known token is findable even before it trends. Spam and low-activity rules still apply in lookup.
    // Its own budget (search-as-you-type must not block contract lookups); over budget it just finds nothing.
    const pairs = await dexscreener.search(q).catch(() => []);
    const top = pairs
      .filter((p) => ent.features.chains.includes(p.chain) && (p.liquidityUsd ?? 0) > 0)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .filter((p, i, all) => all.findIndex((x) => x.chain === p.chain && x.tokenAddress === p.tokenAddress) === i)
      .slice(0, 3);
    await Promise.all(top.map((p) => lookupAddress(p.tokenAddress, [p.chain]).catch(() => [])));
    if (top.length) results = await searchTokens(q, ent.features.chains);
  }
  return ok({ results });
});
