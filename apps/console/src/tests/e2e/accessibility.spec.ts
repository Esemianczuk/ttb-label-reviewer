import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pages = [
  { path: "/", role: null, readyText: "TTB Label Reviewer" },
  { path: "/applicant", role: "applicant", readyText: "Applicant Workspace" },
  { path: "/applicant/applications/new", role: "applicant", readyText: "New Application" },
  { path: "/reviewer/queue", role: "reviewer", readyText: "Review Queue" },
  { path: "/reviewer/applications/app-ttb-19337001000251", role: "reviewer", readyText: "Expected vs Extracted Field Comparison" },
  { path: "/admin", role: "admin", readyText: "Admin Operations" },
  { path: "/admin/workers", role: "admin", readyText: "Workers" },
  { path: "/admin/audit", role: "admin", readyText: "Audit Log" }
] as const;

test.describe("government UI accessibility", () => {
  for (const entry of pages) {
    test(`${entry.path} has no WCAG A/AA axe violations`, async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => window.localStorage.clear());
      if (entry.role) {
        await page.evaluate((role) => window.localStorage.setItem("ttb-console-role", role), entry.role);
      }
      await page.goto(entry.path);
      await expect(page.getByRole("main").getByText(entry.readyText).first()).toBeVisible();

      const h1Count = await page.locator("h1").count();
      expect(h1Count, `${entry.path} should have exactly one h1`).toBe(1);

      const results = await new AxeBuilder({ page }).include(".app-shell").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations, `${entry.path} accessibility violations`).toEqual([]);
    });
  }
});
