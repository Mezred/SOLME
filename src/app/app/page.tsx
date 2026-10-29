import type { Metadata } from "next";
import Link from "next/link";
import { PresetSwitch } from "@/components/app/alert-forms";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { CLASS_META, EarlyCard } from "@/components/app/early-coins";
import { TelegramConnect } from "@/components/app/settings-forms";
import { buttonClass, Card, CardHeader, cx, EmptyState, Freshness, PageHeader } from "@/components/ui";
import { ALERT_PRESETS, presetLock } from "@/lib/alerts/presets";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query, queryOne } from "@/lib/db";
import { earlyFeed } from "@/lib/early/feed";
import { EARLY_MAX_AGE_HOURS, MIN_LIQUIDITY_USD, STALE_MINUTES, type EarlyClass } from "@/lib/early/signals";

export const metadata: Metadata = { title: "Early Coins" };

/** Coins shown on the Free plan; paid plans see the whole feed. */
const FREE_PREVIEW = 5;
/** The two alerts to switch on first (see src/lib/alerts/presets.ts). */
const ONBOARDING_PRESETS = ["early_building", "proven_dev"];
const VIEWS = [
  { key: "all", label: "All active", match: (c: EarlyClass) => c !== "high_risk" },
  { key: "building", label: CLASS_META.building.label, match: (c: EarlyClass) => c === "building" },
  { key: "early", label: CLASS_META.early.label, match: (c: EarlyClass) => c === "early" },
  { key: "risk", label: CLASS_META.high_risk.label, match: (c: EarlyClass) => c === "high_risk" },
] as const;

/** Home of SOLME: fresh Solana coins showing early signs of real activity, each with why it is here and its risk. */
export default async function EarlyCoinsPage({ searchParams }: PageProps<"/app">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const ent = await getEntitlements(user.id);
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const [coins, profile, presetRules, active] = await Promise.all([
    earlyFeed(),
    queryOne<{ telegram_chat_id: string | null; notify_telegram: boolean }>("SELECT telegram_chat_id, notify_telegram FROM profiles WHERE user_id = $1", [user.id]),
    query<{ id: string; is_active: boolean; preset: string }>("SELECT id, is_active, params->>'preset' AS preset FROM alert_rules WHERE user_id = $1 AND params ? 'preset'", [user.id]),
    queryOne<{ n: number }>("SELECT count(*)::int AS n FROM alert_rules WHERE user_id = $1 AND is_active", [user.id]),
  ]);
  const telegramAllowed = ent.features.alert_channels.includes("telegram");
  const telegramOn = telegramAllowed && Boolean(profile?.telegram_chat_id && profile.notify_telegram);
  const setUp = telegramOn && (active?.n ?? 0) > 0;

  const shown = coins.filter((c) => view.match(c.cls!));
  const limited = ent.planId === "free";
  const visible = limited ? shown.slice(0, FREE_PREVIEW) : shown;
  const latest = coins.reduce<Date | null>((m, c) => (!m || c.updatedAt > m ? c.updatedAt : m), null);

  return (
    <>
      <PageHeader
        title="Early Coins"
        description="Fresh Solana coins where real activity is starting, with why each one is here and what to check. These describe what is happening now; they are not predictions."
        badge={<Freshness at={latest} label="Data" />}
        actions={<AutoRefresh seconds={60} />}
      />

      {!setUp && (
        <Card className="mb-4">
          <CardHeader title="Get alerts on your phone" subtitle="SOLME tells you when a coin starts building momentum or a proven dev launches, within seconds." />
          <ol className="divide-y divide-line">
            <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm">
                <span className={telegramOn ? "text-pos" : "text-fg"}>{telegramOn ? "✓" : "1."} Connect Telegram</span>
                <span className="block text-xs text-fg-faint">Alerts with the contract to copy and mute buttons. Send the bot any contract for a Coin Check.</span>
              </div>
              {telegramOn ? <span className="text-xs text-pos">Connected</span> : telegramAllowed ? <TelegramConnect /> : <Link href="/app/billing" className="text-xs text-up hover:underline">Telegram alerts are on Pro →</Link>}
            </li>
            {ONBOARDING_PRESETS.map((key) => ALERT_PRESETS.find((x) => x.key === key)).filter((p) => p !== undefined).map((p) => {
              const rule = presetRules.find((r) => r.preset === p.key);
              return (
                <li key={p.key} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <span className={rule?.is_active ? "text-pos" : "text-fg"}>{rule?.is_active ? "✓ " : ""}{p.title}</span>
                    <span className="block text-xs text-fg-faint">{p.detail}</span>
                  </div>
                  <PresetSwitch preset={{ key: p.key, title: p.title, rule_type: p.rule_type, params: p.params }} ruleId={rule?.id ?? null} active={Boolean(rule?.is_active)} channels={telegramOn ? ["in_app", "telegram"] : ["in_app"]} locked={presetLock(p, ent)} />
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <nav aria-label="Filter coins" className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const n = coins.filter((c) => v.match(c.cls!)).length;
          const on = v.key === view.key;
          return (
            <Link
              key={v.key}
              href={v.key === "all" ? "/app" : `/app?view=${v.key}`}
              aria-current={on ? "page" : undefined}
              className={cx("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs", on ? "border-up bg-up/10 text-up" : "border-line text-fg-muted hover:text-fg")}
            >
              {v.label} <span className="num text-fg-faint">{n}</span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={coins.length === 0 ? "No fresh coins with current data right now" : "No coins in this view right now"}
            body={
              coins.length === 0
                ? `Early Coins lists Solana coins under ${EARLY_MAX_AGE_HOURS / 24} days old with at least $${MIN_LIQUIDITY_USD / 1000}k liquidity and market data under ${STALE_MINUTES} minutes old. The worker refreshes data every ~2 minutes; if this stays empty, check that it is running.`
                : "Coins move between views as their activity changes. Try another view."
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((c) => <EarlyCard key={c.id} c={c} />)}
        </ul>
      )}
      {limited && shown.length > FREE_PREVIEW && (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="text-fg-muted">Showing {FREE_PREVIEW} of {shown.length}. Pro shows every coin and alerts you when one starts building momentum.</span>
          <Link href="/app/billing" className={buttonClass("primary", "sm")}>Upgrade</Link>
        </div>
      )}

      <details className="card mt-6 px-4 py-3 text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">How Early Coins works</summary>
        <div className="mt-3 space-y-2 text-xs text-fg-muted">
          <p>SOLME looks at Solana coins under {EARLY_MAX_AGE_HOURS / 24} days old with at least ${MIN_LIQUIDITY_USD / 1000}k in their pool, using market data under {STALE_MINUTES} minutes old. Each coin is compared with its own recent pace, never ranked by price gains alone.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-fg">Activity signals</b>: 1h volume or transactions at 1.8× or more of the average hour of the last 6h; buy transactions rising and 55%+ of trades. Transactions count trades, not people, so for the top coins SOLME also reads the latest ~100 real pool trades and counts the different wallets buying: 25+ wallets within 90 minutes is a signal of its own, and when 5 or fewer wallets make a busy sample the transaction signals are dropped and the card says so (bots).</li>
            <li><b className="text-fg">Quality signals</b>: smart wallets bought in the last 24h; a proven dev (score 60+) launched it; a pool deep enough for its market cap.</li>
            <li><b className="text-fg">Price</b>: a small signal for rising steadily (+5% to +150% in 1h, not vertical).</li>
          </ul>
          <p><b className="text-pos">{CLASS_META.building.label}</b>: 3+ signals, including rising activity and smart wallets or a proven dev (who is buying matters; a deep pool only adds to the rank). <b className="text-up">{CLASS_META.early.label}</b>: activity rising. <b className="text-down">{CLASS_META.high_risk.label}</b>: active but with a critical finding (contract or launch check failed, liquidity down 40%+ in 2h, price down 40%+ in 1h, dev sold 5%+, or market cap 40× liquidity). Order within a class is the sum of the listed signal weights (smart wallets 2.5–3, volume and proven dev 2, transactions, buys and unique buyers 1.5, pool depth 1, price 0.5).</p>
          <p>A coin without a contract check yet is marked so. None of this predicts price; most fresh coins still go to zero.</p>
        </div>
      </details>
    </>
  );
}
