import { defineConfig } from "@playwright/test";

// Build with synthetic public env first (as in the quality CI job).
// No database, model call, real account or external support request is needed.
export default defineConfig({
  testDir: "tests/support-browser", workers: 1, retries: 0,
  outputDir: "node_modules/.cache/support/browser", reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3109", headless: true,
    viewport: { width: 390, height: 844 }, screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: { command: "npm run start -- --port 3109 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3109/support", reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55438", NEXT_PUBLIC_SUPABASE_ANON_KEY: "support-local-fixture-only" } },
});
