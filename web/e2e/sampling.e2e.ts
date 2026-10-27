import { expect, test } from "@playwright/test";
import { PLUMES, PUBLIC_URL } from "./env";

// Scenario 3: Binangonan, 2026-05-06, 92 ha, 1.4 mm rain in 7 days, prior dry-weather hits in the
// Binangonan watch zone. The agent proposes sampling; it stays pending until a person approves.
const id = PLUMES.dry;

test.describe.serial("dry: Binangonan sampling with human approval", () => {
  test("public visitor sees 'pending approval' but cannot open sampling", async ({ page, request }) => {
    await page.goto(`${PUBLIC_URL}/plumes/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: /Binangonan/ })).toBeVisible();
    await expect(page.locator(".plume-header .pill")).toHaveText("Sampling: pending approval");
    await expect(page.locator(".pill--dry")).toBeVisible();
    await expect(page.locator(".rain + .card__note")).toContainText("Suspicious, verify.");

    await page.goto(`${PUBLIC_URL}/sampling`);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    expect((await request.get(`${PUBLIC_URL}/api/sampling-tasks`)).status()).toBe(401);
    expect(
      (await request.post(`${PUBLIC_URL}/api/sampling-tasks/1/approve`, { data: { note: "drive-by" } })).status(),
    ).toBe(401);
  });

  test("researcher approves the task after a note and a confirmation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".pending__text")).toContainText("sampling task is pending");

    await page.goto(`/plumes/${id}`);
    const decision = page.locator("section", { has: page.getByRole("heading", { name: "Agent decision" }) });
    await expect(decision.locator(".decision__action")).toHaveText("Field sampling requested, pending approval");

    await page.goto("/sampling");
    const card = page.locator("article.task-card", { has: page.getByRole("link", { name: /Binangonan/ }) });
    await expect(card.locator(".pill")).toHaveText("Pending approval");
    await expect(card.locator(".task-card__reason")).toContainText("Suspicious, verify");
    await expect(card.getByRole("list", { name: "Proposed sampling sites" })).toContainText("entry point");
    await expect(card.getByRole("list", { name: "Proposed sampling sites" })).toContainText("plume centroid");

    await card.getByRole("button", { name: "Approve..." }).click();
    await card.getByRole("button", { name: "Review approval" }).click();
    await expect(card.getByText("Add a note explaining your decision.")).toBeVisible();

    await card.getByLabel("Note").fill("Dry week, repeat hits at the river mouth. Sample within 48 h.");
    await card.getByRole("button", { name: "Review approval" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Approve field sampling?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Go back" })).toBeFocused();
    await dialog.getByRole("button", { name: "Yes, approve" }).click();

    await expect(page.getByRole("heading", { name: /Approved \(1\)/ })).toBeVisible();
    const approved = page.locator("article.task-card", { has: page.getByRole("link", { name: /Binangonan/ }) });
    await expect(approved.locator(".task-card__review")).toContainText("Approved by dev");

    await page.goto(`/plumes/${id}`);
    await expect(page.locator(".plume-header .pill")).toHaveText("Sampling approved");
  });

  test("a second decision on the same task is refused with 409", async ({ request }) => {
    const tasks = await (await request.get(`/api/sampling-tasks`)).json();
    const task = tasks.find((t: { event_id: number }) => t.event_id === id);
    expect(task.status).toBe("approved");
    for (const action of ["approve", "reject"]) {
      const res = await request.post(`/api/sampling-tasks/${task.id}/${action}`, { data: { note: "second look" } });
      expect(res.status()).toBe(409);
      expect(await res.json()).toMatchObject({ status: "approved", reviewed_by: "dev" });
    }
  });
});
