import type { PoolConfig } from "pg";

// pg's URL SSL parameters can replace an explicit ssl object. Remove the one
// supported mode and reject conflicting parameters so a CA never disables
// certificate or hostname verification. Plaintext is only for loopback tests.
export function workoutDatabaseConfig(connectionString: string, caCertificate?: string): PoolConfig {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("INVALID_DATABASE_PROTOCOL");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  for (const [key, value] of url.searchParams) {
    if (key === "sslmode" && value === "verify-full") continue;
    if (key.startsWith("ssl") || key === "uselibpqcompat") throw new Error("UNSAFE_DATABASE_TLS_OPTIONS");
  }
  const useTls = !local || Boolean(caCertificate) || url.searchParams.has("sslmode");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: useTls ? { rejectUnauthorized: true, ...(caCertificate ? { ca: caCertificate } : {}) } : false,
  };
}
