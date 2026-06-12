import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

const firstRealApplicationId = "app-ttb-19337001000251";
const correctionRealApplicationId = "app-ttb-19350001000429";
const thirdRealApplicationId = "app-ttb-19346001000245";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as Reviewer" }).click();
});

async function switchAccount(page: Page, accountLabel: string) {
  await page.locator(".account-switcher:visible").click();
  const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last();
  await dropdown.getByText(accountLabel).click();
}

async function injectCriticalFieldFailures(page: Page, applicationId: string, fieldKeys = ["alcoholContent", "netContents"]) {
  await page.evaluate(
    ({ applicationId, fieldKeys }) => {
      const raw = window.localStorage.getItem("ttb-console-snapshot-v1");
      if (!raw) throw new Error("Demo snapshot missing.");
      const snapshot = JSON.parse(raw);
      const application = snapshot.applications?.find((candidate: any) => candidate.id === applicationId);
      if (!application?.review) throw new Error(`Review missing for ${applicationId}.`);
      let changed = 0;
      application.review.fields.forEach((field: any) => {
        field.status = "PASS";
        field.reviewerStatus = undefined;
        field.reviewerReason = undefined;
        field.severity = "info";
        field.confidence = 0.98;
        field.reason = `The detected ${String(field.label).toLowerCase()} evidence matches the expected application value after normalization.`;
        if (fieldKeys.includes(field.fieldKey)) {
          changed += 1;
          field.status = "FAIL";
          field.severity = "critical";
          field.confidence = 0.92;
          field.reason = `${field.label} does not match the extracted label evidence.`;
        }
      });
      if (changed !== fieldKeys.length) throw new Error(`Could not find all requested failure fields for ${applicationId}.`);
      application.review.status = "FAIL";
      application.status = "IN_REVIEW";
      snapshot.activeApplicationId = applicationId;
      window.localStorage.setItem("ttb-console-snapshot-v1", JSON.stringify(snapshot));
    },
    { applicationId, fieldKeys }
  );
}

async function waitForWorkbenchReview(page: Page) {
  await expect(page.getByRole("button", { name: "Raw OCR" })).toBeEnabled({ timeout: 15000 });
}

test("public role entry opens the stored role workspace", async ({ page }) => {
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue as Reviewer" })).toBeVisible();
  await page.getByRole("button", { name: "Continue as Reviewer" }).click();
  await expect(page.getByText("Reviewer Dashboard")).toBeVisible();

  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/");
  await expect(page.getByText("Applicant Workspace")).toBeVisible();

  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/");
  await expect(page.getByText("Admin Operations")).toBeVisible();
});

test("reviewer queue processes first sample and advances without losing decisions", async ({ page }) => {
  await page.goto(`/reviewer/applications/${firstRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /TRANSCONTINENTAL/i })).toBeVisible();
  await expect(page.getByText("Application # TTB-2026-0001")).toBeVisible();
  await expect(page.getByText("Expected vs Extracted Field Comparison")).toBeVisible();
  await expect(page.getByText("Label Images")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Auto-run automation" })).toBeChecked();
  await waitForWorkbenchReview(page);
  await expect(page.getByRole("button", { name: /Run automated review|Rerun automated review/i })).toHaveCount(0);
  const brandField = page.locator('[aria-label="Brand Name field review"]:visible').first();
  await expect(brandField.getByText("Pass").first()).toBeVisible();
  await expect(page.getByText("Warning Segment Checklist")).toHaveCount(0);
  await expect(page.getByText("ABV / Proof Explanation")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Auto" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Reviewer" })).toHaveCount(0);
  if (await page.locator(".reviewer-field-table:visible").count()) {
    await expect(page.getByRole("columnheader", { name: "Result" })).toBeVisible();
  } else {
    await expect(brandField.getByText("Result")).toBeVisible();
  }
  await expect(brandField.getByLabel("Brand Name pass fail decision")).toBeVisible();
  await expect(brandField.getByLabel("Brand Name pass fail decision").getByText("Review")).toHaveCount(0);
  await page.getByRole("button", { name: "Raw OCR" }).click();
  const rawOcrDialog = page.getByRole("dialog", { name: "Drag to move OCR text" });
  await expect(rawOcrDialog).toBeVisible();
  await expect(rawOcrDialog).toContainText("Image:");
  await expect(rawOcrDialog).toContainText("TRINIDAD");
  await expect(rawOcrDialog).not.toContainText("No raw OCR text was stored");
  await page.getByRole("button", { name: "Close Drag to move OCR text" }).click();
  await expect(rawOcrDialog).toBeHidden();

  await page.getByRole("textbox", { name: /Brand Name reasoning/i }).fill("Reviewed: brand evidence matches the application.");
  await page.getByRole("button", { name: /Next Application/i }).click();
  await expect(page).not.toHaveURL(new RegExp(firstRealApplicationId));
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(new RegExp(firstRealApplicationId));
  await expect(page.getByRole("textbox", { name: /Brand Name reasoning/i })).toHaveValue(/Reviewed: brand evidence/);
});

test("reviewer dashboard cards open filtered queue without duplicate header actions", async ({ page }) => {
  await page.goto("/reviewer");
  await expect(page.locator(".header-actions .account-switcher")).toHaveCount(0);
  await expect(page.locator(".account-switcher:visible")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open review queue/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Batch review/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Reports$/i })).toHaveCount(0);
  await expect(page.getByText("Average review time")).toHaveCount(0);
  await page.getByRole("button", { name: /Critical mismatches/i }).click();
  await expect(page).toHaveURL(/\/reviewer\/queue\?filter=critical_fail&from=dashboard/);
  await expect(page.getByText("Filtered: Critical fail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByText("Filtered: Critical fail")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
});

test("reviewer queue is informational, sortable, and expandable", async ({ page }) => {
  await page.goto("/reviewer/queue");
  await expect(page.getByText("Submitted applications")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Process$/ })).toHaveCount(0);
  await expect(page.getByLabel("Search review queue")).toBeVisible();
  await expect(page.getByLabel("Filter queue by company")).toBeVisible();
  await expect(page.getByLabel("Review queue date range").first()).toBeVisible();
  if (await page.locator(".review-queue-table").isVisible()) {
    await expect(page.getByRole("columnheader", { name: "Application" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Submitted" })).toBeVisible();
  } else {
    await expect(page.locator(".queue-mobile-list")).toBeVisible();
  }

  await page.getByRole("button", { name: "Overview" }).first().click();
  const visibleOverview = page.locator(".queue-expanded-overview:visible").first();
  await expect(visibleOverview).toBeVisible();
  await expect(visibleOverview.getByText("Alcohol content", { exact: true })).toBeVisible();
  await expect(visibleOverview.getByText("Net contents", { exact: true })).toBeVisible();
  await visibleOverview.getByRole("button", { name: "Open workbench" }).click();
  await expect(page).toHaveURL(/\/reviewer\/applications\/app-ttb-/);
  await expect(page.getByRole("checkbox", { name: "Auto-run automation" })).toBeChecked();
  await waitForWorkbenchReview(page);
});

test("expanded image viewer supports zoom and close controls", async ({ page }) => {
  await page.locator(".image-card-preview").first().click();
  const expandedViewer = page.getByRole("dialog", { name: "Expanded label image viewer" });
  await expect(expandedViewer).toBeVisible();
  await expect(page.getByText("Drag to move view")).toBeVisible();
  await expect(page.getByText("85%")).toBeVisible();
  const scrollBeforeWheel = await page.evaluate(() => {
    window.scrollTo(0, 420);
    return window.scrollY;
  });
  await page.getByLabel("Pan and zoom image area").hover();
  await page.mouse.wheel(0, -240);
  await expect(page.getByText("105%")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeWheel);
  const canvasBox = await page.getByLabel("Pan and zoom image area").boundingBox();
  if (!canvasBox) throw new Error("Expanded image canvas was not measurable.");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeWheel);
  await page.mouse.click(8, 8);
  await expect(expandedViewer).toBeHidden();

  await page.getByRole("button", { name: "Expand image viewer" }).click();
  await expect(expandedViewer).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("105%")).toBeVisible();
  await page.getByRole("button", { name: "Close expanded viewer" }).click();
  await expect(expandedViewer).toBeHidden();
});

test("reviewer resolves a critical failure and approves the application", async ({ page }) => {
  await page.goto(`/reviewer/applications/${firstRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /TRANSCONTINENTAL/i })).toBeVisible();
  await waitForWorkbenchReview(page);
  await injectCriticalFieldFailures(page, firstRealApplicationId);
  await page.reload();
  await expect(page.getByText("Pass blocked")).toBeVisible();

  const alcoholField = page.locator('[aria-label="Alcohol Content field review"]:visible');
  await expect(alcoholField.locator(".field-evidence-crop-label").first()).toContainText("Full image");
  await alcoholField.getByRole("button", { name: /Review full label image for Alcohol Content/i }).click();
  const fullImageDialog = page.getByRole("dialog", { name: "Expanded label image viewer" });
  await expect(fullImageDialog).toBeVisible();
  await expect(page.getByLabel("Choose label image to review")).toBeVisible();
  await page.getByRole("button", { name: /Show image 2: back/i }).click();
  await expect(page.locator(".floating-viewer-picker-item-active")).toContainText("back");
  await page.getByRole("button", { name: "Close expanded viewer" }).click();
  await expect(fullImageDialog).toBeHidden();
  await alcoholField.getByRole("textbox", { name: /Alcohol Content reasoning/i }).fill("Corrected support confirms the filed ABV.");
  await alcoholField.getByLabel("Alcohol Content pass fail decision").getByText("Pass").click();
  await expect(alcoholField.locator(".machine-evidence-muted")).toHaveCount(2);
  const netContentsField = page.locator('[aria-label="Net Contents field review"]:visible');
  await netContentsField.getByRole("textbox", { name: /Net Contents reasoning/i }).fill("Corrected support confirms the filed net contents.");
  await netContentsField.getByLabel("Net Contents pass fail decision").getByText("Pass").click();

  await page.getByRole("textbox", { name: "Reviewer decision note" }).fill("Critical mismatch resolved by corrected support.");
  await expect(page.getByRole("button", { name: /Pass application/ })).toBeEnabled();
  await page.getByRole("button", { name: /Pass application/ }).click();
  await expect(page.getByText("Application passed.")).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();
  const finalBar = page.locator(".final-disposition-bar");
  await expect(finalBar.getByRole("button", { name: "Pass application" })).toHaveCount(0);
  await expect(finalBar.getByRole("button", { name: "Fail application" })).toHaveCount(0);
  await expect(finalBar.getByRole("button", { name: "Next Application" })).toBeVisible();
  await expect(finalBar.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reviewer decision note" })).toBeDisabled();
  await expect(alcoholField.getByRole("textbox", { name: /Alcohol Content reasoning/i })).toBeDisabled();

  await finalBar.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Application reopened.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pass application/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reviewer decision note" })).toBeEnabled();
});

test("reviewer fails an application with an audit-visible message", async ({ page }) => {
  await page.goto(`/reviewer/applications/${correctionRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /CHLOE/i })).toBeVisible();
  await waitForWorkbenchReview(page);
  await injectCriticalFieldFailures(page, correctionRealApplicationId);
  await page.reload();
  await page.goto("/reviewer");
  await expect(page.getByText(/Alcohol Content does not match|Net Contents does not match/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /View all \d+ issues/ })).toBeVisible();
  await expect(page.getByText("OCR output is evidence, not the final decision. A reviewer must confirm or override unresolved issues.")).toHaveCount(0);
  await expect(page.getByText("Prioritize label-review packets, compare application values against label evidence, and record auditable reviewer decisions.")).toHaveCount(0);
  await page.goto(`/reviewer/applications/${correctionRealApplicationId}`);
  await page.getByRole("textbox", { name: "Reviewer decision note" }).fill("Warning panel remained too ambiguous after review.");
  await page.getByRole("button", { name: /Fail application/ }).click();
  await expect(page.getByText("Application failed.")).toBeVisible();
  await expect(page.getByText("Rejected").first()).toBeVisible();
  await expect(page.locator(".final-disposition-bar").getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(page.locator(".final-disposition-bar").getByRole("button", { name: "Fail application" })).toHaveCount(0);
});

test("reviewer auto-run checkbox runs current and next automation", async ({ page }) => {
  await page.goto(`/reviewer/applications/${firstRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /TRANSCONTINENTAL/i })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Auto-run automation" })).toBeChecked();
  await expect(page.getByText("Review in progress")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".image-processing-overlay")).toBeVisible();
  await expect(page.locator(".live-review-pill")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand image viewer" })).toBeDisabled();
  await waitForWorkbenchReview(page);
  await expect(page.getByRole("button", { name: /Run automated review|Rerun automated review/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Next Application" }).first().click();
  await expect(page).toHaveURL(new RegExp(thirdRealApplicationId));
  await expect(page.getByRole("checkbox", { name: "Auto-run automation" })).toBeChecked();
  await waitForWorkbenchReview(page);
  await expect(page.getByRole("button", { name: /Run automated review|Rerun automated review/i })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Auto-run automation" }).uncheck();
  await expect(page.getByRole("button", { name: "Rerun automated review" })).toBeVisible();
});

test("reviewer dashboard scrolls issue summary to highlighted remediation rows", async ({ page }) => {
  await page.goto(`/reviewer/applications/${firstRealApplicationId}`);
  await waitForWorkbenchReview(page);
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("ttb-console-snapshot-v1");
    if (!raw) throw new Error("Demo snapshot missing.");
    const snapshot = JSON.parse(raw);
    const application = snapshot.applications.find((candidate: any) => candidate.id === "app-ttb-19337001000251");
    if (!application?.review) throw new Error("Review missing.");
    application.review.fields.forEach((field: any, index: number) => {
      field.reviewerStatus = "FAIL";
      field.reviewerReason = `Stress test issue ${index + 1}`;
      if (index < 3) field.severity = "critical";
    });
    snapshot.activeApplicationId = application.id;
    window.localStorage.setItem("ttb-console-snapshot-v1", JSON.stringify(snapshot));
  });
  await page.goto("/reviewer");
  await expect(page.getByRole("button", { name: /View all \d+ issues/ })).toBeVisible();
  await page.getByRole("button", { name: /View all \d+ issues/ }).click();
  await expect(page.getByRole("dialog", { name: "Drag to move review issues" })).toHaveCount(0);
  const governmentWarningIssue = page.locator('[data-review-field-id="app-ttb-19337001000251-governmentWarning"]:visible').first();
  await expect(governmentWarningIssue).toBeInViewport();
  await expect(governmentWarningIssue).toHaveClass(/review-field-needs-attention/);
  await expect(governmentWarningIssue).toHaveClass(/review-field-focus-highlight/);
  await expect(page.getByRole("textbox", { name: /Government Warning reasoning/i })).toHaveValue(/Stress test issue 5/);
});

test("reviewer keyboard shortcut accepts the automated result", async ({ page }) => {
  await page.goto(`/reviewer/applications/${thirdRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /DEVILS BACKBONE/i })).toBeVisible();
  await waitForWorkbenchReview(page);
  const brandCrop = await page.evaluate(() => {
    const snapshot = JSON.parse(window.localStorage.getItem("ttb-console-snapshot-v1") || "{}");
    const application = snapshot.applications?.find((candidate: any) => candidate.id === "app-ttb-19346001000245");
    const brand = application?.review?.fields?.find((field: any) => field.fieldKey === "brandName");
    return brand?.evidence?.[0]?.crop;
  });
  expect(brandCrop).toMatchObject({ source: "ocr", unit: "pixel" });
  expect(brandCrop.y).toBeGreaterThan(580);
  await page.keyboard.press("a");
  await expect(page.getByText("Automated result accepted.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reviewer decision note" })).toHaveValue(/local OCR/i);
});

test("reviewer batch page filters, selects, processes, and downloads a PDF", async ({ page }) => {
  await page.goto("/reviewer/batches");
  await expect(page.getByText("Batch Review").first()).toBeVisible();
  await expect(page.getByText("Processing mode")).toHaveCount(0);
  await expect(page.getByText("Browser Only")).toHaveCount(0);
  await expect(page.getByText("Backend")).toHaveCount(0);
  await expect(page.getByText("Cluster")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Process open batch/ })).toBeDisabled();

  await page.getByLabel("Filter by company").fill("Broken Bow");
  const mobileBatchCards = page.locator(".batch-mobile-list");
  const usingMobileCards = await mobileBatchCards.isVisible();
  if (usingMobileCards) {
    await expect(page.getByLabel(/CHLOE .* batch row/i)).toBeVisible();
    await page.getByLabel(/CHLOE .* batch row/i).getByLabel(/Select CHLOE/i).check();
  } else {
    await expect(page.getByRole("row", { name: /CHLOE/i })).toBeVisible();
    await page.locator(".batch-review-table").getByLabel(/Select CHLOE/i).check();
  }

  await expect(page.getByRole("button", { name: /Process open batch/ })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Process open batch/ }).click();
  await expect(page.getByText(/Processing 1 of 1/)).toBeVisible();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("batch-review");
  await expect(page.getByText("Processed 1 application and downloaded PDFs.")).toBeVisible();
});

test("applicant happy path creates a multi-image packet and submits it", async ({ page }) => {
  test.setTimeout(90000);
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant/applications/new");
  await expect(page.getByRole("heading", { name: "New Application" })).toBeVisible();

  await page
    .locator('input[type="file"][accept=".json,.xml,.html,.htm,.txt,.md,application/json,application/xml,text/xml,text/html,text/plain"]')
    .setInputFiles(path.resolve(process.cwd(), "../../fixtures/public-cola-registry/records/19337001000251/metadata.json"));
  await expect(page.getByText("Needs attention").first()).toBeVisible();
  await expect(page.getByLabel("Brand name")).toHaveValue("TRANSCONTINENTAL");
  await expect(page.getByLabel("Class / type")).toHaveValue("OTHER FOREIGN RUM");
  await page.getByLabel("Alcohol content").fill("40% Alc./Vol. (80 Proof)");
  await page.getByLabel("Net contents").fill("750 mL");
  await page.getByRole("button", { name: "Next" }).click();

  await page
    .locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]')
    .setInputFiles([
      path.resolve(process.cwd(), "../../fixtures/public-cola-registry/records/19337001000251/assets/label_01.jpg"),
      path.resolve(process.cwd(), "../../fixtures/public-cola-registry/records/19337001000251/assets/label_02.jpg")
    ]);
  await expect(page.getByRole("row", { name: /label_01\.jpg Front/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /label_02\.jpg Back/i })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Ready to submit/)).toBeVisible();
  await expect(page.getByText("2 label images")).toBeVisible();
  await page.getByRole("button", { name: /Submit for Review/i }).click();
  await expect(page.getByRole("heading", { name: "TRANSCONTINENTAL application" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Application #")).toBeVisible();
  await expect(page.getByText(/TTB-2026-\d{4}/).first()).toBeVisible();
  await expect(page.getByText("Submitted").first()).toBeVisible();
});

test("applicant folders route, autosave drafts, and allow draft edit deletion", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant/drafts");
  await expect(page).toHaveURL(/\/applicant\/drafts$/);
  await expect(page.getByText("Drafts").first()).toBeVisible();
  await expect(page.getByText("No drafts")).toBeVisible();

  await page.goto("/applicant/submitted");
  await expect(page).toHaveURL(/\/applicant\/submitted$/);
  await expect(page.getByText("Submitted applications")).toBeVisible();
  await expect(page.getByRole("row", { name: /TRANSCONTINENTAL/i })).toBeVisible();

  await page.goto("/applicant/attention");
  await expect(page).toHaveURL(/\/applicant\/attention$/);
  await expect(page.getByText("Needs attention").first()).toBeVisible();
  await expect(page.getByRole("row", { name: /CHLOE/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Packet" })).toBeVisible();

  await page.goto("/applicant/applications/new");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Brand name").fill("AUTOSAVED DRAFT");
  await page.getByLabel("Class / type").fill("Distilled Spirits Specialty");
  await expect.poll(async () =>
    page.evaluate(() => {
      const raw = window.localStorage.getItem("ttb-console-snapshot-v1");
      if (!raw) return false;
      const snapshot = JSON.parse(raw);
      return snapshot.applications.some((application: any) => application.expectedFields.brandName === "AUTOSAVED DRAFT");
    })
  ).toBe(true);

  await page.goto("/applicant");
  await page.getByRole("button", { name: /drafts\. Open drafts folder/i }).click();
  await expect(page).toHaveURL(/\/applicant\/drafts$/);
  const draftRow = page.getByRole("row", { name: /AUTOSAVED DRAFT/i });
  await expect(draftRow).toBeVisible();
  await draftRow.getByRole("button", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/applicant\/applications\/app-manual-\d+\/edit$/);
  await expect(page.getByLabel("Brand name")).toHaveValue("AUTOSAVED DRAFT");

  await page.goto("/applicant/drafts");
  const autosavedRow = page.getByRole("row", { name: /AUTOSAVED DRAFT/i });
  await expect(autosavedRow).toBeVisible();
  await autosavedRow.getByRole("button", { name: "Delete Draft" }).click();
  await page.locator(".ant-popover:visible").getByRole("button", { name: "Delete Draft" }).click();
  await expect(page.getByText("Draft deleted.")).toBeVisible();
  await expect(page.getByRole("row", { name: /AUTOSAVED DRAFT/i })).toHaveCount(0);
});

test("applicant edits a correction packet and resubmits it", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant");
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Onboarding" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update Packet" })).toBeVisible();

  await page.goto(`/applicant/applications/${correctionRealApplicationId}/corrections`);
  await expect(page).toHaveURL(new RegExp(`/applicant/applications/${correctionRealApplicationId}/edit$`));
  await expect(page.getByRole("heading", { name: /Update CHLOE/i })).toBeVisible();
  await expect(page.getByText("Reviewer requested updates")).toBeVisible();
  await expect(page.getByText(/Fields to check: Alcohol Content, Net Contents/)).toBeVisible();
  await expect(page.getByLabel("Response to reviewer")).toHaveCount(0);
  await page.getByLabel("Alcohol content").fill("5.0% Alc./Vol.");
  await page.getByLabel("Net contents").fill("12 FL OZ");
  await page.getByLabel("Notes").fill("Confirmed the warning panel and updated the label image placement.");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Current label image retained for resubmission")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("1 label image")).toBeVisible();
  await page.getByRole("button", { name: "Resubmit Updates" }).click();
  await expect(page.getByRole("heading", { name: /CHLOE/i })).toBeVisible();
  await expect(page.getByText("Resubmitted").first()).toBeVisible();
});

test("applicant archives and restores application packets", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/applicant");
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  const firstRealRow = page.getByRole("row", { name: /TRANSCONTINENTAL/i });
  await expect(firstRealRow).toBeVisible();
  await expect(page.getByRole("button", { name: /View archived \(0\)/ })).toBeVisible();

  await firstRealRow.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Application archived.")).toBeVisible();
  await expect(page.getByRole("row", { name: /TRANSCONTINENTAL/i })).toHaveCount(0);
  await page.getByRole("button", { name: /View archived \(1\)/ }).click();
  await expect(page.getByRole("heading", { name: "Applicant Workspace" })).toBeVisible();
  await expect(page.getByText("Archived application packets")).toBeVisible();
  const archivedFirstRealRow = page.getByRole("row", { name: /TRANSCONTINENTAL/i });
  await expect(archivedFirstRealRow).toBeVisible();
  await expect(archivedFirstRealRow.getByText("Archived")).toBeVisible();

  await archivedFirstRealRow.getByRole("button", { name: "Unarchive" }).click();
  await expect(page.getByText("Application restored to active packets.")).toBeVisible();
  await expect(page.getByText("No archived applications")).toBeVisible();
  await page.getByRole("button", { name: "View active" }).click();
  await expect(page.getByRole("row", { name: /TRANSCONTINENTAL/i })).toBeVisible();
});

test("unauthorized workspace URLs redirect to the active account home", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "applicant"));
  await page.goto("/reviewer");
  await expect(page).toHaveURL(/\/applicant$/);
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/applicant$/);
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await page.goto("/admin/jobs");
  await expect(page).toHaveURL(/\/applicant$/);
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await page.goto("/resources/workers");
  await expect(page).toHaveURL(/\/applicant$/);
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await expect(page.getByText("Access denied")).toHaveCount(0);
  await page.goto("/applicant");
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
});

test("account switching scopes navigation and redirects away from stale workspaces", async ({ page }) => {
  const sidebar = page.locator(".gov-sidebar");
  await expect(page.getByText("Reviewer Dashboard")).toBeVisible();
  await expect(sidebar.getByText("Review Queue")).toBeVisible();
  await expect(sidebar.getByText("New Application")).toHaveCount(0);
  await expect(sidebar.getByText("Users")).toHaveCount(0);

  await page.goto(`/reviewer/applications/${firstRealApplicationId}`);
  await expect(page.getByRole("heading", { name: /TRANSCONTINENTAL/i })).toBeVisible();
  await switchAccount(page, "Applicant - applicant@example.local");
  await expect(page).toHaveURL(/\/applicant$/);
  await expect(page.getByText("Applicant Workspace")).toBeVisible();
  await expect(sidebar.getByText("New Application")).toBeVisible();
  await expect(sidebar.getByText("Review Queue")).toHaveCount(0);
  await expect(sidebar.getByText("Workers")).toHaveCount(0);
  await page.getByRole("button", { name: /Create application packet/i }).first().click();
  await expect(page.getByRole("heading", { name: "New Application" })).toBeVisible();

  await switchAccount(page, "Reviewer - reviewer@example.local");
  await expect(page).toHaveURL(/\/reviewer$/);
  await expect(page.getByText("Reviewer Dashboard")).toBeVisible();
  await expect(sidebar.getByText("Review Queue")).toBeVisible();
  await expect(sidebar.getByText("New Application")).toHaveCount(0);

  await switchAccount(page, "Admin - admin@example.local");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Admin Operations")).toBeVisible();
  await expect(sidebar.getByText("Workers")).toBeVisible();
  await expect(sidebar.getByText("Review Queue")).toHaveCount(0);
  await expect(sidebar.getByText("New Application")).toHaveCount(0);
  await expect(page.getByText("Access denied")).toHaveCount(0);
});

test("admin operations pages expose worker, job, benchmark, and settings actions", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/admin");
  await expect(page.getByText("Applications today")).toBeVisible();
  await expect(page.getByText("Active workers")).toBeVisible();
  await expect(page.getByRole("button", { name: /Workers/ })).toBeVisible();

  await page.goto("/admin/workers");
  await expect(page.getByText("bigbertha.sherpa-map.internal")).toBeVisible();
  await page.getByRole("button", { name: /Drain/ }).first().click();
  await expect(page.getByText("Worker drain requested.")).toBeVisible();

  await page.goto("/admin/jobs");
  await expect(page.getByRole("columnheader", { name: "Scheduler Reason" })).toBeVisible();
  await page.getByRole("button", { name: "Raise" }).first().click();
  await expect(page.getByText("Job raise priority requested.")).toBeVisible();

  await page.goto("/admin/benchmarks");
  await page.getByRole("button", { name: "10 image run" }).click();
  await expect(page.getByText("Benchmark completed.")).toBeVisible();
  await expect(page.getByText("10 image admin run")).toBeVisible();

  await page.goto("/admin/engines");
  await page.getByRole("spinbutton", { name: "Max Concurrency" }).fill("6");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.goto("/admin/settings");
  await page.goto("/admin/engines");
  await expect(page.getByRole("spinbutton", { name: "Max Concurrency" })).toHaveValue("6");
});

test("admin audit and retention pages use real events and confirmations", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/admin/audit");
  await expect(page.getByText("Audit Events")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Application #" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();

  await page.goto("/admin/retention");
  await expect(page.getByText("Retention Actions")).toBeVisible();
  await page.getByRole("button", { name: "Purge Old Jobs" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("Old jobs purged.")).toBeVisible();
});

test("core role pages have no critical axe accessibility violations", async ({ page }) => {
  const pages = [
    { role: "reviewer", path: "/reviewer", text: "Reviewer Dashboard" },
    { role: "applicant", path: "/applicant", text: "Applicant Workspace" },
    { role: "admin", path: "/admin", text: "Admin Operations" }
  ];

  for (const entry of pages) {
    await page.evaluate((role) => window.localStorage.setItem("ttb-console-role", role), entry.role);
    await page.goto(entry.path);
    await expect(page.getByText(entry.text).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".app-content").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, `${entry.path} accessibility violations`).toEqual([]);
  }
});

test("registered resources render through the active browser provider", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/resources/applications");
  await expect(page.getByText("Applications").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Browser Only")).toBeVisible();
  await expect(page.getByText("TRANSCONTINENTAL").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Application Versions" })).toBeVisible();
  await expect(page.locator("#main-content").getByRole("link", { name: "Benchmarks" })).toBeVisible();
});

test("backend LAN mode warning is prominent", async ({ page }) => {
  await page.route("http://127.0.0.1:8000/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        database: "sqlite",
        assetRoot: "data/assets",
        staticDir: "apps/console/dist",
        staticReady: true,
        lanMode: true,
        warning: "LAN MODE ENABLED: coordinator APIs are reachable from the local network."
      })
    })
  );

  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.goto("/admin");
  await page.getByLabel("Processing mode").getByText("Backend").click();
  await expect(page.getByText("LAN mode enabled", { exact: true })).toBeVisible();
  await expect(page.getByText(/LAN MODE ENABLED/)).toBeVisible();
  await expect(page.getByText(/Backend connected - LAN/)).toBeVisible();
});

test("backend mode warns and falls back when coordinator is unavailable", async ({ page }) => {
  await page.evaluate(() => window.localStorage.setItem("ttb-console-role", "admin"));
  await page.evaluate(() => window.localStorage.setItem("ttb-console-backend-url", "http://127.0.0.1:59999"));
  await page.goto("/admin");
  await page.getByLabel("Processing mode").getByText("Backend").click();
  await expect(page.getByText("Backend coordinator unavailable").first()).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Use Browser Only" }).first().click();
  await expect(page.getByRole("radio", { name: "Browser Only" })).toBeChecked();
});
