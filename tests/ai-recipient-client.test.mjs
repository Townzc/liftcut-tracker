import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("JSON model uses the checked config and refuses HTTP redirects", () => {
  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/fixtures/ai-recipient-client.ts"],
    { cwd: process.cwd(), timeout: 15000, stdio: "pipe" });
});
