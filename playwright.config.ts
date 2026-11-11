import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://databrain:databrain@localhost:5432/databrain_test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run db:reset && npm run db:seed && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB,
      DATABRAIN_DEMO_MODE: "true",
      SESSION_SECRET: "e2e-test-secret",
      STORAGE_LOCAL_DIR: ".data/e2e-storage",
    },
  },
});
