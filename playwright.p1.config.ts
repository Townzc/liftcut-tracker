import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/agent-browser", workers: 1, retries: 0, timeout: 60000,
  outputDir: "research/liftcut-agent/outputs/p1-browser",
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3101", headless: true, screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: [
    { command: "node --import tsx tests/agent-db/auth-fixture.ts", url: "http://127.0.0.1:55439/auth/v1/user", reuseExistingServer: !process.env.CI },
    { command: "npm run dev -- --port 3101 --hostname 127.0.0.1", url: "http://localhost:3101/login", reuseExistingServer: !process.env.CI,
      env: { AGENT_DATABASE_URL: process.env.P1_RUNTIME_DATABASE_URL!, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55439",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "p1-local-fixture-anon", AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://127.0.0.1:59999/v1" } },
  ],
});
