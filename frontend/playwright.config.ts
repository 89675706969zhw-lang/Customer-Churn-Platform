import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../output/playwright/test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:18000",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "python -m uvicorn backend.app:app --host 127.0.0.1 --port 18000",
    cwd: root,
    url: "http://127.0.0.1:18000/api/health",
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PYTHONUTF8: "1",
      CHURN_DATA_DIR: fileURLToPath(new URL("../data/raw", import.meta.url)),
      CHURN_CACHE_DIR: fileURLToPath(new URL("../.runtime/e2e", import.meta.url)),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
