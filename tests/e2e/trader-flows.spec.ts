import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e passphrase long enough";

async function signup(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  const cont = page.getByRole("button", { name: "Continue to dashboard" });
  await Promise.race([page.waitForURL(/\/app/), cont.waitFor()]);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForURL(/\/app/);
}

const origin = () => ({ Origin: new URL(test.info().project.use.baseURL!).origin });

/** Opens a page and fails on any browser error. */
async function open(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto(path, { waitUntil: "networkidle" });
  expect(res?.status(), path).toBe(200);
  return errors;
}

test.describe("everyday trader flows", () => {
  test.beforeEach(async ({ page }) => {
    await signup(page);
  });

  test("the sidebar holds the three features and Alerts; Early Coins is home", async ({ page }) => {
    const errors = await open(page, "/app");
    await expect(page.getByRole("heading", { level: 1, name: "Early Coins" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" }).first();
    for (const label of ["Early Coins", "Proven Devs", "Smart Wallets", "Alerts"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    await expect(page.getByRole("link", { name: "Screener" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Coin Check" })).toHaveCount(0);
    // Every coin view, and how the feed works, is one click away.
    for (const view of ["All active", "Building Momentum", "Early Activity", "High Risk"]) await expect(page.getByRole("link", { name: new RegExp(`^${view}`) })).toBeVisible();
    await expect(page.getByText("How Early Coins works")).toBeVisible();
    // A new account is walked through Telegram and the two main alerts.
    await expect(page.getByText("Get alerts on your phone")).toBeVisible();
    await expect(page.getByText("A proven dev launches a new coin")).toBeVisible();
    // The Screener now lands on Early Coins; removed pages are gone.
    await page.goto("/app/screener", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/app$/);
    for (const gone of ["/app/ai", "/app/portfolio", "/app/trenches", "/app/discover"]) expect((await page.request.get(gone)).status(), gone).toBe(404);
    expect(errors).toEqual([]);
  });

  test("old Coin Check links land somewhere useful", async ({ page }) => {
    await page.goto("/app/check", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1, name: "Early Coins" })).toBeVisible();
    // A contract in the old link opens that coin's page (its address resolves to the tracked coin).
    const coin = page.locator("main a[href^='/app/token/']").first();
    if (!(await coin.count())) test.skip(true, "No coins in Early Coins yet");
    const href = (await coin.getAttribute("href"))!;
    await page.goto(href, { waitUntil: "networkidle" });
    const mint = (await page.getByTitle("Copy contract address").first().textContent())!.trim();
    expect(mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    await page.goto(`/app/check?q=${mint}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    // No Coin Check card on the coin page any more.
    await expect(page.getByText("Coin Check", { exact: true })).toHaveCount(0);
  });

  test("Proven Devs renders its launches and leaderboard", async ({ page }) => {
    const errors = await open(page, "/app/smart-dev");
    await expect(page.getByRole("heading", { level: 1, name: "Proven Devs" })).toBeVisible();
    await expect(page.getByText("Proven dev launches").first()).toBeVisible();
    await expect(page.getByText("Dev leaderboard")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Alerts are grouped by feature and the Early Coins alert can be switched on", async ({ page }) => {
    const errors = await open(page, "/app/alerts");
    for (const group of ["Early Coins", "Proven Devs", "Smart Wallets", "Watchlist"]) await expect(page.getByRole("heading", { level: 3, name: group })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coin Check" })).toHaveCount(0);
    await expect(page.getByText("A coin on your watchlist turns risky")).toBeVisible();
    // Saved screener templates still work through the API (they back existing alerts).
    const saved = await page.request.post("/api/screener-templates", { data: { name: `E2E ${Date.now()}`, params: { maxAgeHours: "24" } }, headers: origin() });
    expect(saved.status()).toBe(201);
    // Free plan: the busier Early Coins alert is available.
    const r = await page.request.post("/api/alerts", { data: { name: "Early", rule_type: "early_coin", params: { min_class: "early", contract_ok: true }, channels: ["in_app"] }, headers: origin() });
    expect(r.status()).toBe(201);
    expect(errors).toEqual([]);
  });

  test("quiet hours save, and Telegram linking hands out a bot link", async ({ page }) => {
    const errors = await open(page, "/app/settings");
    await page.getByLabel("Quiet hours").check();
    await page.fill("#qh-s", "23:00");
    await page.fill("#qh-e", "07:00");
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(page.getByText("Quiet hours 23:00–07:00 saved.")).toBeVisible();

    const link = await page.request.post("/api/settings", { data: { action: "telegram_link" }, headers: origin() });
    if (link.ok()) expect((await link.json()).url).toMatch(/^https:\/\/t\.me\/\w+\?start=[\w-]+$/);
    else expect(link.status()).toBe(400); // no bot token configured on this machine
    expect(errors).toEqual([]);
  });
});

test("health reports the live feeds without secrets", async ({ request }) => {
  const body = await (await request.get("/api/health")).json();
  expect(body.status).toBe("ok");
  expect(body.feeds).toHaveProperty("status");
  expect(JSON.stringify(body)).not.toMatch(/api-key|sk-|whsec_|postgres:\/\//);
});
