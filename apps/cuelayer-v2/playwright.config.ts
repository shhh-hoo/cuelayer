import { defineConfig } from "@playwright/test";
const baseURL = process.env.CUELAYER_V2_BASE_URL ?? "http://127.0.0.1:5192";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.browser.ts",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  outputDir: "../../.cuelayer/v2/playwright",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../.cuelayer/v2/playwright-results.json" }],
  ],
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${new URL(baseURL).port}`,
    url: baseURL,
    reuseExistingServer: true,
  },
});
