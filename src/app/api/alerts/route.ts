import { assertChain, getEntitlements } from "@/lib/billing/entitlements";
import { isChainId } from "@/lib/chains";
import { queryOne, withUser } from "@/lib/db";
import { alertRuleInput, ALERT_PARAM_SCHEMAS } from "@/lib/alerts/rules";
import { api, badRequest, notFound, ok, parseBody, requireUser, upgradeRequired } from "@/lib/http";

export const GET = api(async () => {
  const user = await requireUser();
  const rules = await withUser(user.id, (tx) => tx.query("SELECT * FROM alert_rules ORDER BY created_at DESC"));
  return ok({ rules });
});

export const POST = api(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, alertRuleInput);
  const ent = await getEntitlements(user.id);
  const disallowed = b.channels.filter((c) => !ent.features.alert_channels.includes(c));
  if (disallowed.length) throw upgradeRequired(`${disallowed.join(", ")} alerts are not included in the ${ent.planName} plan.`);
  if (b.channels.includes("email") && !user.emailVerified) throw badRequest("Verify your email address before enabling email alerts.");
  if ((b.rule_type === "wallet_activity" || b.rule_type === "smart_wallet_buy") && ent.features.max_tracked_wallets === 0) throw upgradeRequired("Wallet alerts require Pro or Elite.");
  if (["dev_deploy", "curve_progress"].includes(b.rule_type) && !ent.features.chains.includes("solana")) throw upgradeRequired("Launchpad alerts need Solana on your plan.");
  if (b.rule_type === "smart_wallet_buy" && !ent.features.chains.includes("solana")) throw upgradeRequired("Smart-wallet alerts need Solana on your plan.");
  if (b.rule_type === "smart_wallet_buy" && b.params.followed_only !== true && !ent.features.smart_money) throw upgradeRequired("Smart-wallet alerts are part of the Elite plan.");
  if (b.rule_type === "early_coin" && b.params.min_class === "building" && ent.planId === "free") throw upgradeRequired("Building Momentum alerts are on Pro and Elite.");
  if (b.rule_type === "smart_group_buy" && (!ent.features.smart_money || !ent.features.chains.includes("solana"))) throw upgradeRequired("Group-buy alerts are part of the Elite plan (Solana).");
  if (b.rule_type === "screener_match") {
    const [t] = await withUser(user.id, (tx) => tx.query("SELECT 1 FROM screener_templates WHERE id = $1", [b.params.template_id]));
    if (!t) throw notFound("Template not found");
  }
  if (b.chain) {
    if (!isChainId(b.chain)) throw badRequest("Unknown chain");
    assertChain(ent, b.chain);
  }
  if (b.token_id) {
    const t = await queryOne<{ chain: string }>("SELECT chain FROM token_assets WHERE id = $1", [b.token_id]);
    if (!t || !isChainId(t.chain)) throw notFound("Token not found");
    assertChain(ent, t.chain);
  }
  const params = ALERT_PARAM_SCHEMAS[b.rule_type].parse(b.params);
  const id = await withUser(user.id, async (tx) => {
    const [{ n }] = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM alert_rules");
    if (n >= ent.features.max_alert_rules) throw upgradeRequired(`Your plan allows ${ent.features.max_alert_rules} alert rules.`);
    if (b.wallet_id) {
      const [w] = await tx.query("SELECT 1 FROM user_tracked_wallets WHERE wallet_id = $1", [b.wallet_id]);
      if (!w) throw badRequest("Track this wallet before creating an alert for it.");
    }
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO alert_rules (user_id, name, rule_type, chain, token_id, wallet_id, params, channels, cooldown_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [user.id, b.name, b.rule_type, b.chain ?? null, b.token_id ?? null, b.wallet_id ?? null, JSON.stringify(params), b.channels, b.cooldown_minutes],
    );
    return row.id;
  });
  return ok({ id }, { status: 201 });
});
