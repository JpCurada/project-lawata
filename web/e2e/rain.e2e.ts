import { expect, test } from "@playwright/test";
import { PLUMES, PUBLIC_URL } from "./env";

// Scenario 2: Calamba / San Juan River mouth, 2026-09-25, 806 ha brown+dark, after the Sep 16-23
// storm. The agent reads the rainfall and ends in log_expected; nothing goes to sampling.
const id = PLUMES.rain;

test.describe.serial("rain: Calamba post-storm first flush", () => {
  test("public visitor sees the rain that explains it", async ({ page }) => {
    await page.goto(`${PUBLIC_URL}/plumes/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: /Calamba/ })).toBeVisible();
    await expect(page.locator(".plume-header .pill")).toHaveText("Triaged");
    const rain = page.locator(".rain");
    await expect(rain).toContainText("37.5 mm");
    await expect(rain).toContainText("80.6 mm");
    await expect(page.getByText("Recent rain may explain this plume.")).toBeVisible();
    await expect(page.locator(".pill--dry")).toHaveCount(0);
  });

  test("researcher sees log_expected and no sampling task", async ({ page, request }) => {
    await page.goto(`/plumes/${id}`);
    const decision = page.locator("section", { has: page.getByRole("heading", { name: "Agent decision" }) });
    await expect(decision.locator(".decision__action")).toHaveText("Logged as expected (rain or known source)");
    await expect(decision.locator(".decision__reason")).toHaveText("heavy rain in the past week explains the plume");

    const dry = await (await request.get(`/api/plumes?dry_only=true`)).json();
    expect(dry.map((p: { id: number }) => p.id)).not.toContain(id);

    const tasks = await (await request.get(`/api/sampling-tasks`)).json();
    expect(tasks.map((t: { event_id: number }) => t.event_id)).not.toContain(id);

    await page.goto("/sampling");
    await expect(page.getByRole("heading", { level: 1, name: "Sampling" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Calamba/ })).toHaveCount(0);
  });
});
