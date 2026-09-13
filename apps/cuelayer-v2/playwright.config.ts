import { defineConfig } from "@playwright/test";
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
    baseURL: "http://127.0.0.1:5192",
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5192",
    reuseExistingServer: true,
  },
});
