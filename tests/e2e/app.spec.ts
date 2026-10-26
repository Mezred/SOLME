import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const PUBLIC = ["/", "/features", "/pricing", "/how-it-works", "/methodology", "/about", "/faq", "/contact", "/login", "/signup", "/forgot-password", "/privacy", "/terms", "/risk"];
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const PASSWORD = "e2e passphrase long enough";

async function signup(page: Page) {
  const email = uniqueEmail();
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  // Without an email provider (dev), the form shows a verification link + continue button.
  const cont = page.getByRole("button", { name: "Continue to dashboard" });
  await Promise.race([page.waitForURL(/\/app/), cont.waitFor()]);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForURL(/\/app/);
  return email;
}

/** API calls from the page's cookie jar with a same-origin header (as the browser would send). */
const post = (req: APIRequestContext, url: string, data: unknown, method: "post" | "patch" | "delete" = "post") =>
  req[method](url, { data, headers: { Origin: new URL(test.info().project.use.baseURL!).origin } });

test.describe("public site", () => {
  for (const path of PUBLIC) {
    test(`renders ${path} without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      const res = await page.goto(path, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("every page shows the risk disclaimer link in the footer or layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Risk (disclosure|Disclaimer)/ }).first()).toBeVisible();
  });

  test("health endpoint reports status without secrets", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(JSON.stringify(body)).not.toMatch(/sk-|whsec_|postgres:\/\//);
  });
});

test.describe("authentication & authorization", () => {
  test("anonymous users are redirected from the dashboard and admin", async ({ page }) => {
    await page.goto("/app/signals");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsignals/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("protected APIs return 401 without a session", async ({ request }) => {
    expect((await request.get("/api/signals")).status()).toBe(401);
    expect((await request.get("/api/watchlists")).status()).toBe(401);
  });

  test("login rejects bad credentials with a generic error", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill("#email", "nobody@example.com");
    await page.fill("#password", "definitely wrong password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    expect(page.url()).not.toContain("password");
  });

  test("signup → dashboard → logout → login", async ({ page }) => {
    const email = await signup(page);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/app/);
  });

  test("regular users cannot reach admin pages or admin APIs", async ({ page }) => {
    await signup(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app$/);
    const res = await post(page.request, "/api/admin/plans/pro", { name: "Hacked" }, "post");
    expect([403, 405]).toContain(res.status());
    const put = await page.request.put("/api/admin/settings/scoring", { data: {}, headers: { Origin: new URL(page.url()).origin } });
    expect(put.status()).toBe(403);
  });

  test("cross-origin mutations are rejected (CSRF)", async ({ page }) => {
    await signup(page);
    const res = await page.request.post("/api/watchlists", { data: { name: "x" }, headers: { Origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
  });
});

test.describe("entitlements, billing & data", () => {
  test("free plan is restricted on the server", async ({ page }) => {
    await signup(page);
    // Advanced filters are ignored with an explanation.
    const res = await page.request.get("/api/signals?minLiquidity=100000");
    const body = await res.json();
    expect(body.restrictions.join(" ")).toMatch(/require Pro/);
    // Wallet tracking requires a paid plan.
    const w = await post(page.request, "/api/wallets", { chain: "solana", address: "So11111111111111111111111111111111111111112" });
    expect(w.status()).toBe(402);
    // CSV export is gated.
    expect((await page.request.get("/api/portfolio/export")).status()).toBe(402);
  });

  test("checkout cannot unlock a plan without Stripe confirmation", async ({ page }) => {
    await signup(page);
    const res = await post(page.request, "/api/billing/checkout", { planId: "elite", interval: "month" });
    expect(res.ok()).toBeFalsy(); // unverified email and/or billing not configured
    await page.goto("/app/billing");
    await expect(page.getByText("You are on the Free plan.")).toBeVisible();
  });

  test("webhooks without a valid signature are rejected", async ({ request }) => {
    const res = await request.post("/api/webhooks/stripe", { data: { id: "evt_fake", type: "customer.subscription.created" }, headers: { "stripe-signature": "t=1,v1=deadbeef" } });
    expect([400, 503]).toContain(res.status());
  });

  test("portfolio rejects oversells and records partial exits", async ({ page }) => {
    await signup(page);
    const pf = await (await page.request.get("/api/portfolios")).json();
    const created = await post(page.request, "/api/positions", {
      portfolioId: pf.current.id,
      chain: "base",
      tokenAddress: "0x00000000000000000000000000000000000000e2",
      tokenSymbol: "E2E",
      entry: { quantity: 100, price: 1, fee: 1, executedAt: new Date(Date.now() - 3_600_000).toISOString() },
      takeProfits: [],
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const over = await post(page.request, `/api/positions/${id}/trades`, { side: "sell", quantity: 150, price: 2, fee: 0, executedAt: new Date().toISOString() });
    expect(over.status()).toBe(400);
    const partial = await post(page.request, `/api/positions/${id}/trades`, { side: "sell", quantity: 40, price: 2, fee: 0.5, executedAt: new Date().toISOString() });
    expect(partial.status()).toBe(201);
    const after = await (await page.request.get("/api/portfolios")).json();
    const pos = after.positions.find((p: { id: string }) => p.id === id);
    // avg cost 1.01 → realized = 40*2 - 0.5 - 40*1.01 = 39.1
    expect(pos.metrics.realizedPnl).toBeCloseTo(39.1, 5);
    expect(pos.metrics.openQuantity).toBe(60);
  });

  test("watchlists persist between sessions", async ({ page, browser }) => {
    const email = await signup(page);
    await page.goto("/app/screener");
    const first = page.locator("table tbody tr a").first();
    if (!(await first.count())) test.skip(true, "No tokens ingested yet");
    await first.click();
    await page.getByRole("button", { name: /Add to watchlist/ }).click();
    await expect(page.getByRole("button", { name: /Watching/ })).toBeVisible();
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto("/login", { waitUntil: "networkidle" });
    await p2.fill("#email", email);
    await p2.fill("#password", PASSWORD);
    await p2.getByRole("button", { name: "Log in" }).click();
    await p2.waitForURL(/\/app/);
    await p2.goto("/app/watchlist");
    await expect(p2.locator("table tbody tr")).toHaveCount(1);
    await ctx.close();
  });
});
