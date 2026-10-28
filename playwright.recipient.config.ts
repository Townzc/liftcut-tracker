import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/recipient-browser", workers: 1, retries: 0, timeout: 45000,
  outputDir: "node_modules/.cache/recipient/browser", reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3112", viewport: { width: 390, height: 844 }, screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  // All cloud writes/model calls are intercepted by the browser tests; no real account or database.
  webServer: { command: "npm run start -- --port 3112 --hostname 127.0.0.1", url: "http://127.0.0.1:3112/login",
    reuseExistingServer: false, env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55438", NEXT_PUBLIC_SUPABASE_ANON_KEY: "recipient-fixture-only",
      FEATURE_TODAY_SESSION: "true", WORKOUT_DATABASE_URL: "postgres://fixture:unused@127.0.0.1:1/unused",
      AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "https://api.deepseek.com/v1", LOCAL_AI_MODEL: "recipient-fixture",
      COACH_SIGNING_SECRET: "synthetic-recipient-signing-key-not-production" } },
});
