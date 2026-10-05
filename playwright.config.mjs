import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: "list",
  use: { ...devices["Desktop Safari"], bypassCSP: true },
});
