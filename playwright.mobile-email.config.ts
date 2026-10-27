import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/mobile-email-browser", workers: 1, retries: 0,
  outputDir: "node_modules/.cache/mobile-email/browser", reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3110", headless: true, viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: { command: "npm run start -- --port 3110 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3110/auth/mobile-callback?attempt=11111111-1111-4111-8111-111111111111&code=33333333-3333-4333-8333-333333333333",
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55438", NEXT_PUBLIC_SUPABASE_ANON_KEY: "mobile-email-local-fixture-only" } },
});
