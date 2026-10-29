/**
 * Central, server-only configuration (never import from client components).
 * Nothing here is ever sent to the browser.
 * Every integration is optional; `integrations` reports what is configured so the UI can be honest.
 */
function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const v = str(name);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  appUrl: str("APP_URL") ?? "http://localhost:3000",

  databaseUrl: str("DATABASE_URL"),
  pgliteDir: str("PGLITE_DIR") ?? ".data/pglite",

  /** DEMO_MODE=true forces the clearly-labelled demo dataset instead of provider ingestion. */
  demoMode: bool("DEMO_MODE", false),
  /** Run the job scheduler inside the Next.js server (default when using embedded PGlite). */
  workerInProcess: bool("WORKER_IN_PROCESS", !str("DATABASE_URL")),
  cronSecret: str("CRON_SECRET"),

  sessionDays: num("SESSION_DAYS", 30),

  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  aiModel: str("AI_MODEL") ?? "claude-opus-5-5",
  aiEffort: (str("AI_EFFORT") ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  /** USD per million tokens, used for cost tracking only. */
  aiInputPricePerMTok: num("AI_INPUT_PRICE_PER_MTOK", 4),
  aiOutputPricePerMTok: num("AI_OUTPUT_PRICE_PER_MTOK", 20),

  /** Your Solana wallet that receives crypto subscription payments (USDC or SOL, via Solana Pay). */
  solanaPayRecipient: str("SOLANA_PAY_RECIPIENT"),

  resendApiKey: str("RESEND_API_KEY"),
  emailFrom: str("EMAIL_FROM") ?? "SOLME <alerts@example.com>",

  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),

  heliusApiKey: str("HELIUS_API_KEY"),
  goplusAppKey: str("GOPLUS_APP_KEY"),
  /** Optional GMGN referral code appended to "Trade on GMGN" links. */
  gmgnReferralCode: str("GMGN_REFERRAL_CODE"),
  goplusAppSecret: str("GOPLUS_APP_SECRET"),

  bootstrapAdminEmail: str("BOOTSTRAP_ADMIN_EMAIL")?.toLowerCase(),
};

export const integrations = {
  database: env.databaseUrl ? "postgres" : "pglite",
  ai: Boolean(env.anthropicApiKey),
  email: Boolean(env.resendApiKey),
  telegram: Boolean(env.telegramBotToken),
  helius: Boolean(env.heliusApiKey),
} as const;
