import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
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

test("reviewer resolves a critical failure and approves the application", async ({ page }) => {
  await page.goto("/reviewer/applications/app-riverlight-rye-whiskey");
  await expect(page.getByRole("heading", { name: /Riverlight rye/i })).toBeVisible();
  await expect(page.getByText("Approval blocked")).toBeVisible();

  const alcoholRow = page.getByRole("row", { name: /Alcohol Content/i });
  await alcoholRow.getByRole("textbox", { name: /Alcohol Content reasoning/i }).fill("Corrected support confirms the filed ABV.");
  await alcoholRow.getByText("Pass").click();

  await page.getByRole("textbox", { name: "Reviewer decision note" }).fill("Critical mismatch resolved by corrected support.");
  await page.getByRole("button", { name: /check-circle Approve/ }).click();
  await expect(page.getByText("Application approved.")).toBeVisible();
  await expect(page.getByText("review.decision.approve")).toBeVisible();
});

test("reviewer requests a correction with an audit-visible message", async ({ page }) => {
  await page.goto("/reviewer/applications/app-sundaze-hard-seltzer");
  await expect(page.getByRole("heading", { name: /Sundaze/i })).toBeVisible();
  await page.getByRole("button", { name: "Request Correction" }).click();
  await expect(page.getByRole("dialog", { name: "Request Applicant Correction" })).toBeVisible();
  await page.getByLabel("Correction message").fill("Please confirm the government warning panel and upload the corrected back label.");
  await page.getByRole("button", { name: "Send Correction Request" }).click();
  await expect(page.getByText("Correction request sent.")).toBeVisible();
  await expect(page.getByText("correction.request")).toBeVisible();
});

test("reviewer keyboard shortcut accepts a high-confidence pass", async ({ page }) => {
  await page.goto("/reviewer/applications/app-highland-coast-lightkeeper-gin");
  await expect(page.getByRole("heading", { name: /Highland Coast/i })).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText("Automated result accepted.")).toBeVisible();
  await expect(page.getByText("review.decision.accept_auto")).toBeVisible();
});

test("applicant happy path creates a multi-image packet and submits it", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant/applications/new");
  await expect(page.getByText("New Application")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Brand name").fill("EVALUATOR TEST");
  await page.getByLabel("Fanciful name").fill("Phase Nine Console Smoke");
  await page.getByLabel("Class / type").fill("Distilled Spirits Specialty");
  await page.getByLabel("Alcohol content").fill("40% Alc./Vol.");
  await page.getByLabel("Net contents").fill("750 mL");
  await page.getByLabel("Producer / importer").fill("Evaluator Spirits");
  await page.getByLabel("Country of origin").fill("United States");
  await page.getByLabel("TTB application ID").fill("PHASE-9-E2E");
  await page.getByRole("button", { name: "Next" }).click();

  await page
    .locator('input[type="file"]')
    .setInputFiles([
      path.resolve(process.cwd(), "../../browser-demo/public/label-packets/hollow-ridge-bourbon/cola-sheet.png"),
      path.resolve(process.cwd(), "../../browser-demo/public/label-packets/highland-coast-lightkeeper-gin/cola-sheet.png")
    ]);
  await expect(page.getByRole("row", { name: /cola-sheet\.png Front/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /cola-sheet\.png Back/i })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("2 label images")).toBeVisible();
  await page.getByRole("button", { name: /Submit Application/i }).click();
  await expect(page.getByText("Application submitted.")).toBeVisible();
  await expect(page.getByText("EVALUATOR TEST application")).toBeVisible();
  await expect(page.getByText("Submitted").first()).toBeVisible();
});

test("applicant can respond to a correction and resubmit", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant/applications/app-sundaze-hard-seltzer/corrections");
  await expect(page.getByText("Correction requested")).toBeVisible();
  await page.getByLabel("Response to reviewer").fill("Confirmed the warning panel and updated the back label image.");
  await page.getByRole("button", { name: "Resubmit" }).click();
  await expect(page.getByText("Correction response submitted.")).toBeVisible();
  await expect(page.getByText("Current response: Confirmed the warning panel")).toBeVisible();
});

test("applicant role cannot open reviewer or admin workspaces", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/reviewer");
  await expect(page.getByText("Access denied")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByText("Access denied")).toBeVisible();
  await page.goto("/resources/workers");
  await expect(page.getByText("Access denied")).toBeVisible();
  await page.goto("/applicant");
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
});

test("reviewer surface has no critical axe accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).include(".app-content").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("registered resources render through the active browser provider", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/resources/applications");
  await expect(page.getByText("Applications").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Browser Only")).toBeVisible();
  await expect(page.getByText("Hollow Ridge bourbon COLA sheet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Application Versions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Benchmarks" })).toBeVisible();
});

test("backend mode warns and falls back when coordinator is unavailable", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-backend-url", "http://127.0.0.1:59999"));
  await page.goto("/");
  await page.getByLabel("Processing mode").getByText("Backend").click();
  await expect(page.getByText("Backend coordinator unavailable").first()).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Use Browser Only" }).first().click();
  await expect(page.getByRole("radio", { name: "Browser Only" })).toBeChecked();
});
