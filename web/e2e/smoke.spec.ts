import { expect, test } from "@playwright/test";

test("load → click a company → run an Anthropic IPO → impact table renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. the stack loads with real snapshot data
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /The AI stack/ })).toBeVisible();
  await expect(page.locator("[data-company]").first()).toBeVisible();
  expect(await page.locator("[data-company]").count()).toBeGreaterThan(50);

  // 2. clicking a company opens its drawer with evidence links (≤ 1 click)
  await page.locator('[data-company="nvda"]').first().click();
  const drawer = page.getByRole("dialog", { name: "NVIDIA" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: /source/ }).first()).toHaveAttribute("href", /^https:\/\//);

  // 3. from the drawer of a private lab, jump to the simulator and run an IPO
  await page.keyboard.press("Escape");
  await page.locator('[data-company="anthropic"]').first().click();
  await page.getByRole("dialog", { name: "Anthropic" }).getByRole("button", { name: /Simulate a shock/ }).click();
  await expect(page.getByRole("heading", { name: "Event simulator" })).toBeVisible();
  await expect(page.getByText("Illustrative model, not a forecast or financial advice.").first()).toBeVisible();
  await page.getByRole("radio", { name: /IPO/ }).check();

  // 4. ranked impacts across ≥ 4 layers, each with a cited why-chain
  const rows = page.getByTestId("impact-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(10);
  const layers = new Set(await rows.locator("td:nth-child(2) span.text-ink-3, td:nth-child(2) > span").allInnerTexts());
  expect([...layers].filter((l) => /power|infra|semicap|chips|cloud|models|apps/.test(l)).length).toBeGreaterThanOrEqual(4);
  await expect(rows.first().getByRole("link", { name: /source for/ }).first()).toHaveAttribute("href", /^https:\/\//);

  expect(errors).toEqual([]);
});
