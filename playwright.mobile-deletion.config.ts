import { defineConfig } from "@playwright/test";
// Isolated Expo browser rendering with intercepted synthetic HTTP; no database or live Auth.
export default defineConfig({
  testDir: "tests/mobile-web", testMatch: "deletion.spec.ts", workers: 1, retries: 0, timeout: 30000,
  outputDir: "node_modules/.cache/mobile-deletion", reporter: [["list"]],
  use: { baseURL: "http://localhost:8099", viewport: { width: 390, height: 844 }, locale: "zh-CN", headless: true,
    screenshot: "only-on-failure", launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: { command: "node tests/mobile-web/serve.mjs", url: "http://localhost:8099", reuseExistingServer: false },
});
