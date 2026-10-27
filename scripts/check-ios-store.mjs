import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const publicNames = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"];
const releaseGates = ["apple-membership-and-signing", "production-environment-readback", "signed-device-acceptance",
  "native-account-lifecycle", "published-privacy-and-support", "ai-recipient-disclosure",
  "privacy-labels-and-retention", "export-compliance", "store-metadata-and-real-screenshots"];

function publicKey(value) {
  if (typeof value !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  // Inspect only the role; this is a format check, not signature/auth verification.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try { return JSON.parse(Buffer.from(value.split(".")[1], "base64url")).role === "anon"; }
  catch { return false; }
}

/** Offline only. Never fetches, builds, submits, loads .env or returns input values. */
export function inspectStore(eas, app, environment = {}) {
  const issues = [], p = eas?.build?.["ios-store"], expo = app?.expo;
  // EAS platform-specific common options override the root profile.
  const ios = { ...p, ...p?.ios };
  if (!p || p.extends || ios.developmentClient !== false || ios.distribution !== "store" ||
    ios.environment !== "production" || ios.autoIncrement !== true || ios.simulator !== false ||
    ios.buildConfiguration !== "Release") issues.push("store-profile-must-be-explicit-release-device-production");
  if (eas?.cli?.appVersionSource !== "remote") issues.push("remote-build-number-required");
  if (expo?.ios?.bundleIdentifier !== "com.liftcuttracker.app") issues.push("unreviewed-bundle-identifier");
  if (!/^\d+\.\d+\.\d+$/.test(expo?.version ?? "")) issues.push("invalid-app-version");
  if (expo?.extra?.eas?.projectId !== "f45a9ecf-0ed7-47e2-a87c-77fa8877d8ea") issues.push("unreviewed-expo-project");
  if ([p?.env, p?.ios?.env].some(env => env && Object.keys(env).length)) issues.push("inline-profile-environment-needs-review");
  if (!environment || Array.isArray(environment) || typeof environment !== "object") {
    issues.push("public-environment-must-be-an-object"); environment = {};
  }
  if (Object.keys(environment).some(name => !publicNames.includes(name))) issues.push("unexpected-environment-key");
  const origins = ["https://www.liftcuttracker.com", "https://ksyopvedhzpxirfyfkhw.supabase.co"];
  for (const [index, name] of publicNames.slice(0, 2).entries()) {
    if (environment[name] !== origins[index]) issues.push(`${name}:missing-or-unreviewed-origin`);
  }
  if (!publicKey(environment[publicNames[2]])) issues.push(`${publicNames[2]}:public-key-required`);
  return { scope: "offline-configuration-only", configurationValid: issues.length === 0, issues,
    appStoreReady: false, remainingReleaseGates: releaseGates };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--public-env")) throw new Error("arguments");
    const read = path => JSON.parse(readFileSync(path, "utf8"));
    const report = inspectStore(read(new URL("../apps/mobile/eas.json", import.meta.url)),
      read(new URL("../apps/mobile/app.json", import.meta.url)), args.length ? read(args[1]) : {});
    console.log(JSON.stringify(report, null, 2));
    // Valid configuration still cannot authorize submission or native acceptance.
    process.exitCode = report.configurationValid ? 2 : 1;
  } catch {
    console.error("Cannot inspect inputs. Usage: node scripts/check-ios-store.mjs [--public-env reviewed-public-only.json]");
    process.exitCode = 1;
  }
}
