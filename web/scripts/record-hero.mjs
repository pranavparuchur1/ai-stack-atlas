// Records frames for the README hero GIF from a running preview (default http://localhost:4180).
// Usage: node scripts/record-hero.mjs [baseUrl] [outDir]   then assemble with scripts/make_gif.py
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4180/";
const out = process.argv[3] ?? "hero-frames";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1, colorScheme: "dark" });
let n = 0;
const shot = async (count = 1, gap = 120) => {
  for (let i = 0; i < count; i++) {
    await page.screenshot({ path: `${out}/${String(n++).padStart(4, "0")}.png` });
    if (gap) await page.waitForTimeout(gap);
  }
};

await page.goto(base);
await page.locator("[data-company]").first().waitFor();
await page.waitForTimeout(800);
await shot(10, 150); // the stack

await page.locator('[data-company="nvda"]').first().hover();
await page.waitForTimeout(300);
await shot(6, 150); // tooltip
await page.locator('[data-company="nvda"]').first().click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(700);
await shot(10, 150); // drawer with evidence

await page.goto(`${base}#/simulator?company=anthropic`);
await page.getByTestId("impact-row").first().waitFor();
await page.getByRole("radio", { name: /IPO/ }).check();
// re-trigger the ripple from the start for a clean capture
const slider = page.getByRole("slider", { name: /Listing valuation/ });
await slider.focus();
await page.keyboard.press("ArrowRight");
await shot(26, 90); // ripple hop by hop
await page.waitForTimeout(300);
await shot(8, 150);
await page.mouse.wheel(0, 520);
await page.waitForTimeout(400);
await shot(12, 150); // ranked table with why-chains
await browser.close();
console.log(`${n} frames -> ${out}`);
