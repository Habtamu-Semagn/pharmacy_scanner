import { defineConfig } from "@playwright/test";

import {
  BASE_URL,
  MOCK_PORT,
  MOCK_URL,
  PROD_ORIGIN,
  PROD_PORT,
  PROD_URL,
  SITE_PORT,
  TEST_KEY,
  TEST_TIMEOUT_MS,
} from "./tests/env";

// Runs the standalone production build (`npm run build` first) against the mock platform.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1, // tests share the mock platform's in-memory state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    // The installed Google Chrome; no Playwright browser download needed.
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node scripts/mock-platform.mjs",
      url: `${MOCK_URL}/__samples`,
      env: { MOCK_PLATFORM_PORT: String(MOCK_PORT), PHARMACY_API_KEY: TEST_KEY },
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: "node .next/standalone/server.js",
      url: `${BASE_URL}/api/health`,
      env: {
        PORT: String(SITE_PORT),
        HOSTNAME: "127.0.0.1",
        PLATFORM_API_URL: MOCK_URL,
        PHARMACY_API_KEY: TEST_KEY,
        PLATFORM_TIMEOUT_MS: String(TEST_TIMEOUT_MS),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Same build in production mode: only X-Endod-Client-IP is trusted.
      command: "node .next/standalone/server.js",
      url: `${PROD_URL}/api/health`,
      env: {
        PORT: String(PROD_PORT),
        HOSTNAME: "127.0.0.1",
        PLATFORM_API_URL: MOCK_URL,
        PHARMACY_API_KEY: TEST_KEY,
        SITE_ORIGIN: PROD_ORIGIN,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
