import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "e2e passphrase long enough";

async function signup(page: Page) {
  const email = `e2e-a11y-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
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

/** Serious and critical WCAG 2.1 A/AA problems on the page (axe-core), as readable lines. */
async function audit(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path} · ${v.id} (${v.impact}): ${v.help} · ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  test("public pages", async ({ page }) => {
    const found: string[] = [];
    for (const path of ["/", "/pricing", "/features", "/faq", "/login", "/signup"]) found.push(...(await audit(page, path)));
    expect(found, found.join("\n")).toEqual([]);
  });

  test("product pages", async ({ page }) => {
    test.setTimeout(180_000);
    await signup(page);
    const found: string[] = [];
    for (const path of ["/app", "/app/smart-dev", "/app/smart-money", "/app/alerts", "/app/watchlist", "/app/wallets", "/app/billing", "/app/settings"]) {
      found.push(...(await audit(page, path)));
    }
    // A coin page, when Early Coins lists one.
    await page.goto("/app", { waitUntil: "networkidle" });
    const coin = page.locator("main a[href^='/app/token/']").first();
    if (await coin.count()) {
      const href = await coin.getAttribute("href");
      found.push(...(await audit(page, href!)));
    }
    expect(found, found.join("\n")).toEqual([]);
  });
});
