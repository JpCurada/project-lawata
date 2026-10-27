import { expect, test } from "@playwright/test";
import { PLUMES, PUBLIC_URL } from "./env";

// Scenario 1: Pililla, 2026-04-21, 100 ha. The agent sees a cloud edge and ends in mark_artifact.
const id = PLUMES.artifact;

test.describe.serial("artifact: Pililla cloud edge", () => {
  test("public visitor sees the plume but not the agent decision", async ({ page, request }) => {
    await page.goto(`${PUBLIC_URL}/plumes/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: /Pililla/ })).toBeVisible();
    await expect(page.locator(".plume-header .pill")).toHaveText("Triaged");
    await expect(page.getByRole("heading", { name: "Sign in to see the agent's assessment and reviews" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent decision" })).toHaveCount(0);

    const body = await (await request.get(`${PUBLIC_URL}/api/plumes/${id}`)).json();
    expect(body.viewer).toBe("public");
    expect(body.latest_decision).toBeNull();

    // KNOWN ISSUE (blueprint E5): is_dry ignores the agent's verdict, so until a human marks it an
    // artifact, the public page labels a cloud edge "Dry weather ... Suspicious, verify."
    test.info().annotations.push({ type: "known-issue", description: "E5 public blame risk" });
    await expect(page.locator(".pill--dry")).toBeVisible();
    await expect(page.locator(".rain + .card__note")).toContainText("Suspicious, verify.");
  });

  test("researcher sees mark_artifact and confirms it with a review", async ({ page }) => {
    await page.goto(`/plumes/${id}`);
    const decision = page.locator("section", { has: page.getByRole("heading", { name: "Agent decision" }) });
    await expect(decision.locator(".decision__action")).toHaveText("Marked as an image artifact");
    await expect(decision.locator(".decision__reason")).toHaveText("cloud edge visible at 10 m");
    await expect(page.getByText("No reviews yet. Be the first to check this plume.")).toBeVisible();

    const form = page.getByRole("form", { name: "Add a review" });
    await form.getByRole("button", { name: "Save review" }).click();
    await expect(form.getByText("Choose a verdict.")).toBeVisible();

    await form.getByLabel("Not a plume (image artifact)").check();
    await form.getByLabel("Note").fill("Cloud edge along the Pililla shore at 10 m; not water.");
    await form.getByRole("button", { name: "Save review" }).click();
    await expect(form.getByRole("status")).toHaveText("Review saved.");
    await expect(page.getByRole("list", { name: "Reviews" })).toContainText("dev");

    // The human verdict now drives status and removes the dry-weather label.
    await page.reload();
    await expect(page.locator(".plume-header .pill")).toHaveText("Reviewed");
    await expect(page.locator(".pill--dry")).toHaveCount(0);
  });
});
