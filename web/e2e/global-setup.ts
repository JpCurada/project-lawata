import { execFileSync } from "node:child_process";
import { E2E_DATABASE_URL } from "./env";

// Rebuild the throwaway database before every run so the scenarios start from the same state.
export default function globalSetup() {
  const out = execFileSync("uv", ["run", "--project", "../api", "python", "e2e/fixtures/reset_db.py"], {
    env: { ...process.env, E2E_DATABASE_URL },
    encoding: "utf8",
  });
  console.log(out.trim());
}
