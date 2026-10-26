// Seeds demo accounts and sample user data for local development and staging.
// Usage: npm run db:seed            (accounts + sample watchlist/portfolio/alerts)
//        DEMO_MODE=true npm run db:seed   (also generates the labeled synthetic market dataset)
// Never run against production with real users.
import { hashPassword } from "@/lib/auth/password";
import { getDb, query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureDemoData } from "@/lib/demo/seed";

const PASSWORD = process.env.SEED_PASSWORD ?? "nexalpha-demo-2026";
const ACCOUNTS = [
  { email: "admin@nexalpha.local", role: 3, plan: "elite" },
  { email: "elite@nexalpha.local", role: 1, plan: "elite" },
  { email: "pro@nexalpha.local", role: 1, plan: "pro" },
  { email: "free@nexalpha.local", role: 1, plan: null },
];

async function main() {
  if (env.isProd && process.env.ALLOW_PROD_SEED !== "true") throw new Error("Refusing to seed in production (set ALLOW_PROD_SEED=true to override).");
  const db = await getDb();
  if (env.demoMode) await ensureDemoData(true);
  const hash = await hashPassword(PASSWORD);

  for (const a of ACCOUNTS) {
    const u = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, email_verified_at) VALUES ($1, $2, $3, now())
       ON CONFLICT ((lower(email))) DO UPDATE SET role_id = EXCLUDED.role_id RETURNING id`,
      [a.email, hash, a.role],
    );
    const id = u!.id;
    await query("INSERT INTO profiles (user_id, display_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [id, a.email.split("@")[0]]);
    await query("INSERT INTO watchlists (user_id, name) VALUES ($1, 'Main') ON CONFLICT DO NOTHING", [id]);
    await query("INSERT INTO portfolios (user_id, name) VALUES ($1, 'Main') ON CONFLICT DO NOTHING", [id]);
    if (a.plan) {
      // Seed entitlement as an admin grant — clearly not a payment.
      await query("DELETE FROM subscriptions WHERE user_id = $1 AND source = 'admin_grant'", [id]);
      await query(
        "INSERT INTO subscriptions (user_id, plan_id, source, status, current_period_start, current_period_end) VALUES ($1, $2, 'admin_grant', 'active', now(), now() + interval '365 days')",
        [id, a.plan],
      );
    }
    // Sample data from whatever tokens exist (demo or live).
    const tokens = await query<{ id: string; chain: string; address: string; symbol: string; price: number | null }>(
      `SELECT t.id, t.chain, t.address, t.symbol, (SELECT price_usd FROM market_snapshots s WHERE s.token_id = t.id ORDER BY captured_at DESC LIMIT 1) AS price
         FROM token_assets t WHERE t.is_demo = $1 AND NOT t.is_spam AND t.chain = ANY($2) ORDER BY t.updated_at DESC LIMIT 4`,
      [env.demoMode, a.plan ? ["solana", "ethereum", "bsc", "base"] : ["solana", "base"]],
    );
    const wl = await queryOne<{ id: string }>("SELECT id FROM watchlists WHERE user_id = $1 ORDER BY created_at LIMIT 1", [id]);
    for (const t of tokens) {
      await query("INSERT INTO watchlist_items (watchlist_id, user_id, token_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [wl!.id, id, t.id]);
    }
    const pf = await queryOne<{ id: string }>("SELECT id FROM portfolios WHERE user_id = $1 ORDER BY created_at LIMIT 1", [id]);
    const hasPositions = await queryOne("SELECT 1 FROM positions WHERE user_id = $1", [id]);
    if (!hasPositions) {
      for (const [i, t] of tokens.slice(0, 2).entries()) {
        if (!t.price) continue;
        const entry = t.price * (i === 0 ? 0.9 : 1.05);
        const pos = await queryOne<{ id: string }>(
          `INSERT INTO positions (portfolio_id, user_id, token_id, chain, token_address, token_symbol, stop_loss, take_profits, notes, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Seeded sample position', now() - interval '3 days') RETURNING id`,
          [pf!.id, id, t.id, t.chain, t.address, t.symbol, entry * 0.85, JSON.stringify([{ price: entry * 1.3 }, { price: entry * 1.8 }])],
        );
        await query("INSERT INTO trades (position_id, user_id, side, quantity, price, fee, executed_at) VALUES ($1, $2, 'buy', 1000, $3, 1.5, now() - interval '3 days')", [pos!.id, id, entry]);
        if (i === 0) await query("INSERT INTO trades (position_id, user_id, side, quantity, price, fee, executed_at, note) VALUES ($1, $2, 'sell', 400, $3, 1, now() - interval '1 day', 'Partial take-profit')", [pos!.id, id, entry * 1.2]);
      }
    }
    const hasAlerts = await queryOne("SELECT 1 FROM alert_rules WHERE user_id = $1", [id]);
    if (!hasAlerts) {
      await query(
        `INSERT INTO alert_rules (user_id, name, rule_type, params, channels, cooldown_minutes) VALUES ($1, 'High-score momentum', 'signal_score', $2, '{in_app}', 60)`,
        [id, JSON.stringify({ min_score: 70, signal_types: ["momentum", "accumulation"] })],
      );
    }
    console.log(`Seeded ${a.email} (${a.plan ?? "free"})`);
  }
  console.log(`\nAll seed accounts use password: ${PASSWORD}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
