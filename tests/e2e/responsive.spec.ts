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
