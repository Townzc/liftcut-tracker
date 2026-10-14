import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/product-browser", testMatch: "workout-null.spec.ts", workers: 1, retries: 0, timeout: 60000,
  outputDir: "node_modules/.cache/w1a/browser",
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3102", viewport: { width: 390, height: 844 }, headless: true,
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.W1A_BROWSER_EXECUTABLE },
  },
  webServer: {
    command: "npm run dev -- --port 3102 --hostname 127.0.0.1",
    url: "http://localhost:3102/login", reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55438",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "w1a-local-fixture-only", AI_PROVIDER: "local",
      LOCAL_AI_BASE_URL: "http://127.0.0.1:59999/v1", AGENT_DATABASE_URL: "" },
  },
});
