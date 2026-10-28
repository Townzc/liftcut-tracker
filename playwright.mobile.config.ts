import { defineConfig } from "@playwright/test";
// The Expo app's web export (apps/mobile/dist, built with the EXPO_PUBLIC_* values
// below) against the real API, PostgreSQL and the local auth double. Reuses the
// W1b production build, so run it after that build and not alongside W1b.
const authUrl = "http://127.0.0.1:55440", runtime = process.env.W1B_RUNTIME_DATABASE_URL!;
export default defineConfig({
  testDir: "tests/mobile-web", workers: 1, retries: 0, timeout: 60000,
  outputDir: "node_modules/.cache/mobile-web/browser", reporter: [["list"]],
  use: { baseURL: "http://localhost:8099", viewport: { width: 390, height: 844 }, locale: "zh-CN", headless: true,
    screenshot: "only-on-failure", launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: [
    { command: "node --import tsx tests/product-browser/model-fixture.ts", url: "http://127.0.0.1:59999", reuseExistingServer: false },
    { command: "node --import tsx tests/agent-db/auth-fixture.ts", url: `${authUrl}/auth/v1/user`, reuseExistingServer: false,
      env: { P1_TEST_DATABASE_URL: process.env.W1B_TEST_DATABASE_URL!, AUTH_FIXTURE_PORT: "55440" } },
    { command: "node --import ./tests/product-browser/model-transport-preload.mjs node_modules/next/dist/bin/next start --port 3103 --hostname 127.0.0.1", url: "http://localhost:3103/login", reuseExistingServer: false,
      env: { WORKOUT_DATABASE_URL: runtime, AGENT_DATABASE_URL: runtime.replace("liftcut_workout:w1b-local-fixture-only", "liftcut_agent:p1-local-fixture-only"),
        NEXT_PUBLIC_SUPABASE_URL: authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: "w1b-local-fixture-anon", FEATURE_TODAY_SESSION: "true",
        AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "https://api.deepseek.com/v1", AUTH_FIXTURE_PORT:"55440", COACH_SIGNING_SECRET: "synthetic-browser-signing-key-not-for-production" } },
    { command: "node tests/mobile-web/serve.mjs", url: "http://localhost:8099", reuseExistingServer: false },
  ],
});
