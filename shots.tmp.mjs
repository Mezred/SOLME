// Screenshot helper: node shots.mjs <outDir> <email> <password> <path...>
import { chromium } from "playwright";

const [outDir, email, password, ...paths] = process.argv.slice(2);
const base = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

if (email) {
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/, { timeout: 60000 });
}
for (const p of paths) {
  const [path, w] = p.split("@");
  if (w) await page.setViewportSize({ width: Number(w), height: 900 });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const name = (path.replace(/[^a-z0-9]+/gi, "_") || "root") + (w ? `_${w}` : "");
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  console.log("shot", name);
  if (w) await page.setViewportSize({ width: 1440, height: 900 });
}
console.log("console errors:", JSON.stringify(errors.slice(0, 10)));
await browser.close();
