import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectStore } from "../scripts/check-ios-store.mjs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const eas = read("../apps/mobile/eas.json"), app = read("../apps/mobile/app.json");
const env = { EXPO_PUBLIC_API_URL: "https://www.liftcuttracker.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://ksyopvedhzpxirfyfkhw.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_fixture_not_a_real_key" };

test("valid store configuration is never an App Store or device acceptance", () => {
  const result = inspectStore(eas, app, env);
  assert.equal(result.configurationValid, true); assert.equal(result.appStoreReady, false);
  assert.ok(result.remainingReleaseGates.includes("signed-device-acceptance"));
});
test("internal, simulator, inherited and development profiles cannot stand in for store", () => {
  for (const change of [{ distribution: "internal" }, { developmentClient: true }, { extends: "preview" },
    { environment: "preview" }, { ios: { buildConfiguration: "Release", simulator: true } }]) {
    const changed = structuredClone(eas); Object.assign(changed.build["ios-store"], change);
    assert.equal(inspectStore(changed, app, env).configurationValid, false);
  }
});
test("missing and nonproduction endpoints fail without echoing input values", () => {
  assert.equal(inspectStore(eas, app).configurationValid, false);
  for (const url of ["http://127.0.0.1:3000", "https://example.com", "https://www.liftcuttracker.com/?token=private-value"]) {
    const result = inspectStore(eas, app, { ...env, EXPO_PUBLIC_API_URL: url });
    assert.equal(result.configurationValid, false); assert.ok(!JSON.stringify(result).includes(url));
  }
});
test("platform overrides cannot turn a valid root profile into an internal/dev build", () => {
  for (const change of [{ distribution: "internal" }, { developmentClient: true },
    { environment: "preview" }, { autoIncrement: false }, { env: { SECRET: "DO_NOT_DISCLOSE" } }]) {
    const changed = structuredClone(eas); Object.assign(changed.build["ios-store"].ios, change);
    const result = inspectStore(changed, app, env);
    assert.equal(result.configurationValid, false); assert.ok(!JSON.stringify(result).includes("DO_NOT_DISCLOSE"));
  }
});
test("secret keys and signed-in user tokens are rejected; legacy anon format remains supported", () => {
  const jwt = role => ["header", Buffer.from(JSON.stringify({ role })).toString("base64url"), "signature"].join(".");
  for (const key of ["sb_secret_DO_NOT_DISCLOSE", jwt("service_role"), jwt("authenticated")]) {
    const result = inspectStore(eas, app, { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: key });
    assert.equal(result.configurationValid, false); assert.ok(!JSON.stringify(result).includes(key));
  }
  assert.equal(inspectStore(eas, app, { ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt("anon") }).configurationValid, true);
  assert.equal(inspectStore(eas, app, { ...env, SERVICE_ROLE_KEY: "DO_NOT_DISCLOSE" }).configurationValid, false);
});
test("wrong app/project and inline environment cannot bypass reviewed target checks", () => {
  const changedApp = structuredClone(app); changedApp.expo.ios.bundleIdentifier = "com.example.other";
  assert.equal(inspectStore(eas, changedApp, env).configurationValid, false);
  changedApp.expo.extra.eas.projectId = "other";
  assert.ok(inspectStore(eas, changedApp, env).issues.includes("unreviewed-expo-project"));
  const changedEas = structuredClone(eas); changedEas.build["ios-store"].env = { SECRET: "DO_NOT_DISCLOSE" };
  assert.equal(inspectStore(changedEas, app, env).configurationValid, false);
});
