import { defineConfig } from "@playwright/test";

// A local GoTrue + PostgREST stack with automatic table grants disabled.
const authUrl = process.env.API_GRANTS_SUPABASE_URL;
if (!authUrl || !["localhost", "127.0.0.1"].includes(new URL(authUrl).hostname)) throw Error("Local Supabase required");
export default defineConfig({
  testDir: "tests/product-browser", testMatch: "api-grants.spec.ts", workers: 1, retries: 0, timeout: 60000,
  outputDir: "node_modules/.cache/api-grants/browser", reporter: [["list"]],
  use: { baseURL: "http://localhost:3105", headless: true, viewport: { width: 390, height: 844 },
    screenshot: "only-on-failure", launchOptions: { executablePath: process.env.P1_BROWSER_EXECUTABLE } },
  webServer: { command: "npm run start -- --port 3105 --hostname 127.0.0.1", url: "http://localhost:3105/login", reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.API_GRANTS_ANON_KEY!,
      FEATURE_TODAY_SESSION: "false", AGENT_DATABASE_URL: "", WORKOUT_DATABASE_URL: "", AI_PROVIDER: "local" } },
});
