import { defineConfig } from "@playwright/test";
// Explicit opt-in Expo web fixture export only; this is not native or SMTP acceptance.
export default defineConfig({
  testDir: "tests/mobile-signup-web", workers: 1, retries: 0,
  outputDir: "node_modules/.cache/mobile-signup-web", reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8099", viewport: { width: 390, height: 844 }, headless: true,
    launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: { command: "node tests/mobile-web/serve.mjs", url: "http://127.0.0.1:8099", reuseExistingServer: false },
});
