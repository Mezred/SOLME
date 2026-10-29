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

  test("top bar leads to Overview, Screener, Check a coin, Proven Devs, Smart Wallets and Alerts", async ({ page }) => {
    const errors = await open(page, "/app");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const nav = page.getByRole("navigation").first();
    for (const label of ["Overview", "Screener", "Check a coin", "Proven Devs", "Smart Wallets", "Alerts"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Early" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Track Record" })).toHaveCount(0);
    // A new account is walked through Telegram and the two main alerts.
    await expect(page.getByText("Get set up")).toBeVisible();
    await expect(page.getByText("A proven dev launches a new coin")).toBeVisible();
    // Removed pages are gone.
    for (const gone of ["/app/ai", "/app/portfolio", "/app/trenches", "/app/discover"]) expect((await page.request.get(gone)).status(), gone).toBe(404);
    expect(errors).toEqual([]);
  });

  test("Proven Devs renders its launches and leaderboard", async ({ page }) => {
    const errors = await open(page, "/app/smart-dev");
    await expect(page.getByRole("heading", { level: 1, name: "Proven Devs" })).toBeVisible();
    await expect(page.getByText("Proven dev launches").first()).toBeVisible();
    await expect(page.getByText("Dev leaderboard")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Screener shows coverage, accepts the new filters, saves a template and switches its alert on", async ({ page }) => {
    const errors = await open(page, "/app/screener?maxAgeHours=24&minVolume=50000&launchpad=pump&scamCheck=passed&maxMcapLiq=10");
    await expect(page.getByText(/tracked pairs match/)).toBeVisible();
    // Free plan: the advanced filters are explained, not silently ignored.
    await expect(page.getByText(/require Pro/).first()).toBeVisible();

    const name = `E2E ${Date.now()}`;
    const saved = await page.request.post("/api/screener-templates", { data: { name, params: { maxAgeHours: "24", minVolume: "50000" } }, headers: origin() });
    expect(saved.status()).toBe(201);
    await page.reload({ waitUntil: "networkidle" });
    const bell = page.getByRole("button", { name: `Alert me when a coin matches ${name}` });
    await bell.click();
    await expect(page.getByRole("button", { name: `Stop alerts for ${name}` })).toBeVisible();
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
