import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("intl provider configures a stable default time zone", () => {
  const source = read("src/components/i18n/app-intl-provider.tsx");
  assert.match(source, /timeZone="Asia\/Shanghai"/);
});

test("guest mode enters the app without forcing onboarding", () => {
  const login = read("src/components/auth/login-form.tsx");
  const register = read("src/components/auth/register-form.tsx");
  assert.match(login, /router\.replace\("\/"\)/);
  assert.match(register, /router\.replace\("\/"\)/);
});

test("guest AI requests receive profile defaults before validation", () => {
  const helper = read("src/app/api/ai/_profile.ts");
  assert.match(helper, /withGuestAiProfileDefaults/);
  assert.match(helper, /age: base\.age > 0 \? base\.age : 30/);
  assert.match(helper, /weeklyTrainingDays: base\.weeklyTrainingDays > 0 \? base\.weeklyTrainingDays : 3/);
});

test("dashboard exposes the primary daily actions", () => {
  const dashboard = read("src/components/dashboard/dashboard-page.tsx");
  assert.match(dashboard, /actionCenterTitle/);
  assert.match(dashboard, /href=\/plan\/ai|href=\{todayPlan \? "\/workout" : "\/plan\/ai"\}/);
  assert.match(dashboard, /href="\/nutrition"/);
  assert.match(dashboard, /href="\/body"/);
});

test("guest migration keeps the active user plan inactive when importing guest plans", () => {
  const migration = read("src/services/guest-migration.ts");
  assert.match(migration, /isActive: false/);
  assert.match(migration, /saveTrainingPlanAsInactive/);
  assert.match(migration, /appendAiGenerationHistoryForUser/);
});
