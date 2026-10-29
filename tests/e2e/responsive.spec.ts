import { expect, test } from "@playwright/test";

test("home page has no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await expect(page.getByRole("link", { name: "Pricing" }).last()).toBeVisible();
});

test("pricing page stacks plan cards on mobile", async ({ page }) => {
  await page.goto("/pricing", { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
});

test("signed-in pages fit a phone: Overview, Screener and Proven Devs", async ({ page }) => {
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.fill("#email", `e2e-m-${Date.now()}@example.com`);
  await page.fill("#password", "e2e passphrase long enough");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  const cont = page.getByRole("button", { name: "Continue to dashboard" });
  await Promise.race([page.waitForURL(/\/app/), cont.waitFor()]);
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.waitForURL(/\/app/);
  for (const path of ["/app", "/app/screener", "/app/smart-dev"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  // The Screener lists tokens as cards on a phone (the wide table is hidden).
  await page.goto("/app/screener", { waitUntil: "networkidle" });
  await expect(page.locator("table.table-terminal").first()).toBeHidden();
});
