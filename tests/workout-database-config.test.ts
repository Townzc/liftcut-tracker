import { test } from "node:test";
import assert from "node:assert/strict";
import { workoutDatabaseConfig } from "../src/lib/workout-database-config";

test("hosted workout connection verifies TLS even without URL sslmode", () => {
  assert.deepEqual(workoutDatabaseConfig("postgresql://workout:fixture@db.example.invalid:6543/postgres").ssl, { rejectUnauthorized: true });
  const config = workoutDatabaseConfig("postgresql://workout:fixture@db.example.invalid/postgres?sslmode=verify-full", "fixture-ca");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "fixture-ca" });
  assert.equal(new URL(config.connectionString!).searchParams.has("sslmode"), false);
});
test("URL SSL overrides cannot weaken verification or discard the configured CA", () => {
  for (const option of ["sslmode=disable", "sslmode=require", "sslmode=no-verify", "ssl=false", "sslrootcert=x", "uselibpqcompat=true"])
    assert.throws(() => workoutDatabaseConfig(`postgresql://user:fixture@db.example.invalid/db?${option}`, "fixture-ca"), /UNSAFE_DATABASE_TLS_OPTIONS/);
});
test("only loopback test databases can use plaintext by default", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.equal(workoutDatabaseConfig(`postgresql://user:fixture@${host}/test`).ssl, false);
  assert.deepEqual(workoutDatabaseConfig("postgresql://user:fixture@localhost.example.invalid/db").ssl, { rejectUnauthorized: true });
  assert.throws(() => workoutDatabaseConfig("https://db.example.invalid"), /INVALID_DATABASE_PROTOCOL/);
});
