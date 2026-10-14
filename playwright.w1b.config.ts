import { defineConfig } from "@playwright/test";
const authPort=process.env.AUTH_FIXTURE_PORT||"55440",authUrl=`http://127.0.0.1:${authPort}`;
const common = { WORKOUT_DATABASE_URL: process.env.W1B_RUNTIME_DATABASE_URL!, NEXT_PUBLIC_SUPABASE_URL: authUrl,
  AGENT_DATABASE_URL:process.env.W1B_RUNTIME_DATABASE_URL?.replace("liftcut_workout:w1b-local-fixture-only","liftcut_agent:p1-local-fixture-only")??"",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "w1b-local-fixture-anon", AI_PROVIDER: "local", LOCAL_AI_BASE_URL: "http://127.0.0.1:59999/v1",
  COACH_SIGNING_SECRET:"synthetic-browser-signing-key-not-for-production" };
export default defineConfig({
  testDir: "tests/product-browser", testMatch: ["today.spec.ts", "workout-null.spec.ts", "sentence.spec.ts", "outbox.spec.ts", "replacement.spec.ts", "coach.spec.ts", "minimal-agent.spec.ts", "model-chat.spec.ts", "plan-chat.spec.ts", "stream-chat.spec.ts"], workers: 1, retries: 0, timeout: 60000,
  outputDir: "node_modules/.cache/w1b/browser", reporter: [["list"]],
  use: { baseURL: "http://localhost:3103", headless: true, viewport: { width:390,height:844 },
    timezoneId: "America/Los_Angeles", screenshot:"only-on-failure", trace:"retain-on-failure", launchOptions:{ executablePath:process.env.P1_BROWSER_EXECUTABLE } },
  webServer:[
    {command:"node --import tsx tests/product-browser/model-fixture.ts",url:"http://127.0.0.1:59999",reuseExistingServer:false},
    { command:"node --import tsx tests/agent-db/auth-fixture.ts",url:`${authUrl}/auth/v1/user`,reuseExistingServer:false,
      env:{ P1_TEST_DATABASE_URL:process.env.W1B_TEST_DATABASE_URL!,AUTH_FIXTURE_PORT:authPort } },
    ...[3103,3104].map(port=>({command:`npm run start -- --port ${port} --hostname 127.0.0.1`,url:`http://localhost:${port}/login`,reuseExistingServer:false,
      env:{...common,FEATURE_TODAY_SESSION:port===3103?"true":"false"}})),
  ],
});
