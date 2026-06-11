import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
});

test("reviewer queue processes first sample and advances without losing decisions", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /Hollow Ridge bourbon/i })).toBeVisible();
  await expect(page.getByText("Application Match Review")).toBeVisible();
  await expect(page.getByText("Pass").first()).toBeVisible();

  await page.getByRole("textbox", { name: /Brand Name reasoning/i }).fill("Reviewed: brand evidence matches the application.");
  await page.getByRole("button", { name: /Next Application/i }).click();
  await expect(page.getByRole("heading", { name: /Highland Coast/i })).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("textbox", { name: /Brand Name reasoning/i })).toHaveValue(/Reviewed: brand evidence/);
});

test("expanded image viewer supports zoom and close controls", async ({ page }) => {
  await page.getByRole("button", { name: "Expand image viewer" }).click();
  await expect(page.getByRole("dialog", { name: "Expanded label image viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("120%")).toBeVisible();
  await page.getByRole("button", { name: "Close expanded viewer" }).click();
  await expect(page.getByRole("dialog", { name: "Expanded label image viewer" })).toBeHidden();
});

test("applicant can upload one image, enter TTB fields, and auto review", async ({ page }) => {
  await page.goto("/applicant");
  await expect(page.getByText("One-Image Application Intake")).toBeVisible();

  await page.getByLabel("Brand name").fill("EVALUATOR TEST");
  await page.getByLabel("Fanciful name").fill("Console Smoke");
  await page.getByLabel("Class / type").fill("Distilled Spirits Specialty");
  await page.getByLabel("Alcohol content").fill("40% Alc./Vol.");
  await page.getByLabel("Net contents").fill("750 mL");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve(process.cwd(), "../../browser-demo/public/label-packets/hollow-ridge-bourbon/cola-sheet.png"));
  await page.getByRole("button", { name: /Submit And Auto Review/i }).click();
  await expect(page.getByText("Application created and sent to auto review.")).toBeVisible();
  await expect(page.getByText("EVALUATOR TEST manual review")).toBeVisible();
});

test("reviewer surface has no critical axe accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).include(".app-content").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});
