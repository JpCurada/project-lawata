import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PUBLIC_URL } from "./env";

// Scenario 4: a researcher draws a box on the Explore map and the agent investigates its center.
// Dev mode has no agent runtime (AGENT_RUNTIME_ARN unset), so the real API answers 503. The UI
// flow runs on a RECORDED response: the live replay of Binangonan 2026-05-06 (real OpenCV 10 m
// inspection, Open-Meteo rain, production history SQL; docs/blueprint/traces-live.json).
const recorded = JSON.parse(readFileSync(new URL("./fixtures/analysis-binangonan-live.json", import.meta.url), "utf8"));
const crop = readFileSync(new URL("./fixtures/area-crop-binangonan.jpg", import.meta.url));
const lakeBox = { west: 121.14, south: 14.49, east: 121.16, north: 14.51 };

async function drawBox(page: Page, dx: number, dy: number) {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("map canvas has no size");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x - dx, y - dy);
  await page.mouse.click(x + dx, y + dy);
}

test.describe.serial("area analysis: researcher draws a box", () => {
  test("public visitor has no analysis button and the API refuses", async ({ page, request }) => {
    await page.goto(`${PUBLIC_URL}/explore`);
    await expect(page.locator(".explore__count")).toContainText("plumes");
    await expect(page.getByRole("button", { name: "Analyze an area" })).toHaveCount(0);
    expect((await request.post(`${PUBLIC_URL}/api/analyses`, { data: lakeBox })).status()).toBe(401);
  });

  test("dev-mode API has no agent runtime (503)", async ({ request }) => {
    const res = await request.post("/api/analyses", { data: lakeBox });
    expect(res.status()).toBe(503);
    expect(await res.json()).toMatchObject({ detail: "Area analysis is not set up here." });
  });

  test("researcher draws a box and reads the recorded agent decision", async ({ page, request }) => {
    const tasksBefore = (await (await request.get("/api/sampling-tasks")).json()).length;
    let sent: Record<string, number> | null = null;
    await page.route("**/api/analyses", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: recorded });
    });
    await page.route("**/e2e-fixtures/area-crop.jpg", (route) => route.fulfill({ body: crop, contentType: "image/jpeg" }));

    await page.goto("/explore");
    await page.getByRole("button", { name: "Analyze an area" }).click();
    const panel = page.getByRole("region", { name: "Analyze an area" });
    await expect(panel).toContainText("Drag a box on the lake, or tap two opposite corners.");

    // Too big first: the client refuses before any request.
    await drawBox(page, 300, 200);
    await expect(panel.getByRole("alert")).toContainText("Keep each side under 5 km; draw again.");
    await expect(panel.getByRole("button", { name: "Analyze", exact: true })).toHaveCount(0);

    await drawBox(page, 25, 20);
    await expect(panel).toContainText(/Box \d+\.\d × \d+\.\d km/);
    await panel.getByRole("button", { name: "Analyze", exact: true }).click();

    const run = panel.getByRole("region", { name: "Agent run" });
    await expect(run.locator(".agent-run__decision-label")).toHaveText("Field sampling requested, pending approval");
    await expect(panel).toContainText("Sentinel-2 pass of 2026-05-06");
    await expect(run).toContainText("dry weather, shore-attached, seen before");
    await expect(panel.getByRole("img", { name: "10 m crop with the marks the agent looked at" })).toBeVisible();
    for (const step of ["Looked at the 10 m image", "Checked recent rainfall", "Checked earlier plumes nearby"]) {
      await expect(run).toContainText(step);
    }
    expect(sent).not.toBeNull();
    const body = sent as unknown as Record<string, number>;
    expect(body.west).toBeLessThan(body.east);
    expect(body.south).toBeLessThan(body.north);

    // KNOWN GAP (blueprint E10): analyses are not stored, so a sampling proposal from a drawn box
    // creates no task, no decision row and no audit trail.
    test.info().annotations.push({ type: "known-gap", description: "E10 analysis stores nothing" });
    expect((await (await request.get("/api/sampling-tasks")).json()).length).toBe(tasksBefore);
  });

  test("a cloud-forced recheck is labelled as clouds, not as an artifact", async ({ page }) => {
    const clouded = structuredClone(recorded);
    clouded.trace = [
      { tool: "inspect_plume", args: { id: "area-e2e0002" }, result: { plume_found: false, clear_water_frac: 0.04 } },
      { tool: "schedule_recheck", args: { reason: "no clear view, check next pass" } },
    ];
    Object.assign(clouded, {
      action: "schedule_recheck",
      decision_status: "recheck",
      reason: "no clear view, check next pass",
      crop_url: null,
      crop_kind: null,
    });
    await page.route("**/api/analyses", (route) => route.fulfill({ json: clouded }));

    await page.goto("/explore");
    await page.getByRole("button", { name: "Analyze an area" }).click();
    await drawBox(page, 25, 20);
    const panel = page.getByRole("region", { name: "Analyze an area" });
    await panel.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(panel.locator(".agent-run__decision-label")).toHaveText("Clouds hide the water, re-check on the next pass");
  });
});
