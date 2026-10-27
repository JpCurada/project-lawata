/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: /api/* goes to the FastAPI server (uvicorn on :8000).
// In AWS, CloudFront routes /api/* to the API Lambda, so the same paths work.
// LAWATA_API_PROXY lets the e2e suite point a second dev server at a public (auth-on) API, and
// LAWATA_VITE_CACHE gives that server its own dependency cache so the two never race on it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "LAWATA_");
  return {
    plugins: [react()],
    cacheDir: env.LAWATA_VITE_CACHE ?? "node_modules/.vite",
    server: { proxy: { "/api": env.LAWATA_API_PROXY ?? "http://localhost:8000" } },
    test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
  };
});
