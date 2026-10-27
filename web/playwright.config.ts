import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, PUBLIC_URL, RESEARCHER_URL } from "./e2e/env";

// The three demo scenarios against dev mode. Two stacks share one throwaway Postgres:
// - researcher: API with AUTH_DISABLED=true (every request is "dev") + web with VITE_AUTH_MODE=dev
// - public:     API with auth on and no Cognito config (every request is anonymous) + plain web
// Dev mode alone can't show the public view: AUTH_DISABLED makes even signed-out calls "dev".
// Servers are never reused, so a dev server pointed at Neon can't be picked up by accident.
const api = (port: number, authDisabled: boolean) => ({
  command: `uv run --project ../api uvicorn lawata.api.app:app --port ${port}`,
  url: `http://localhost:${port}/api/health`,
  reuseExistingServer: false,
  env: {
    DATABASE_URL: E2E_DATABASE_URL,
    DATABASE_URL_PARAM: "",
    AUTH_DISABLED: String(authDisabled),
    COGNITO_USER_POOL_ID: "",
    COGNITO_CLIENT_ID: "",
    // Never reach the deployed agent or the evidence bucket from the suite.
    AGENT_RUNTIME_ARN: "",
    LAWATA_BUCKET: "",
  },
});

const web = (port: number, apiPort: number, authMode: string) => ({
  // --force: fresh dependency bundle every run, so a stale cache can't make the suite flaky.
  command: `npx vite --port ${port} --strictPort --force`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  env: {
    VITE_AUTH_MODE: authMode,
    LAWATA_API_PROXY: `http://localhost:${apiPort}`,
    LAWATA_VITE_CACHE: `node_modules/.vite-e2e-${port}`,
  },
});

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  // One shared database: run files one after another.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: { baseURL: RESEARCHER_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    api(8000, true),
    api(8001, false),
    web(5173, 8000, "dev"),
    web(Number(new URL(PUBLIC_URL).port), 8001, ""),
  ],
});
