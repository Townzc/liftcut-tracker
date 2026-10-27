import { test } from "node:test";
import assert from "node:assert/strict";
import { isRecentRecovery, safeAuthRedirect } from "../src/lib/supabase/recovery-policy";

test("recovery requires recent verified Auth method and an identified session", () => {
  const claims = { role: "authenticated", sub: "owner", session_id: "session", amr: [{ method: "recovery", timestamp: 1000 }] };
  assert.equal(isRecentRecovery(claims, 1100), true);
  for (const patch of [{ role: "anon" }, { sub: "" }, { session_id: null }, { amr: [] },
    { amr: [{ method: "password", timestamp: 1000 }] }, { amr: [{ method: "recovery", timestamp: 1 }] },
    { amr: [{ method: "recovery", timestamp: 1200 }] }, { amr: null, user_metadata: { recovery: true } }]) {
    assert.equal(isRecentRecovery({ ...claims, ...patch }, 1100), false);
  }
});
test("OAuth destinations cannot escape the application or carry callback secrets", () => {
  for (const value of [null, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid",
    "%2f%2fevil.invalid", "/bad%", "/agent?code=secret", "/agent#token", "/\n/evil.invalid"]) {
    assert.equal(safeAuthRedirect(value), "/onboarding");
  }
  for (const value of ["/agent", "/onboarding", "/settings/account"]) assert.equal(safeAuthRedirect(value), value);
});
