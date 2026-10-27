import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const startDeletion = z.object({ requestId: z.uuid(), confirmed: z.literal(true) }).strict();
export const resumeDeletion = z.object({ receipt: z.string().min(40).max(2048) }).strict();
const proof = z.object({ purpose: z.literal("account-deletion-v1"), owner: z.uuid(), requestId: z.uuid(), expires: z.number().int() }).strict();
type Proof = z.infer<typeof proof>;
export class DeletionError extends Error {
  constructor(public code: "reauthenticate" | "invalid_receipt" | "receipt_expired" | "owner_mismatch" | "pending" | "unavailable") { super(code); }
}
export function recentAuthentication(claims: Record<string, unknown>, owner: string, now = Date.now() / 1000) {
  return claims.sub === owner && claims.role === "authenticated" && typeof claims.session_id === "string" &&
    Array.isArray(claims.amr) && claims.amr.some(item => ["password", "oauth", "recovery"].includes(item?.method) &&
      typeof item.timestamp === "number" && item.timestamp <= now + 30 && item.timestamp >= now - 300);
}
export function deletionReceipt(owner: string, requestId: string, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new DeletionError("unavailable");
  const data = Buffer.from(JSON.stringify(proof.parse({ purpose: "account-deletion-v1", owner, requestId, expires: now + 3600_000 }))).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
export function verifyDeletionReceipt(value: string, secret: string, now = Date.now(), completionOnlyAfterExpiry = false): Proof {
  try {
    if (secret.length < 32 || value.length > 2048) throw new Error();
    const parts = value.split(".");
    if (parts.length !== 2) throw new Error();
    const [data, signature] = parts, actual = Buffer.from(signature ?? "", "base64url");
    const expected = createHmac("sha256", secret).update(data ?? "").digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const parsed = proof.parse(JSON.parse(Buffer.from(data, "base64url").toString()));
    if ((!completionOnlyAfterExpiry && parsed.expires <= now) || parsed.expires > now + 3600_000) throw new Error();
    return parsed;
  } catch { throw new DeletionError("invalid_receipt"); }
}
export type DeletionAdapter = {
  exists(owner: string): Promise<boolean>;
  begin(owner: string, requestId: string, session?: string): Promise<void>;
  files(owner: string, requestId: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
  deleteUser(owner: string): Promise<void>;
};
/** No SQL object deletion: remove via Storage API, then Auth's transactional cascade.
 * A lost response retries the same operation. Only a verified, previously issued
 * receipt may reach this service; a free-form owner from an HTTP body never does.
 */
export function matchDeletionOwner(owner: string, activeOwner: string | null, expectedOwner: string | null) {
  if ((activeOwner && activeOwner !== owner) || (expectedOwner && expectedOwner !== owner)) throw new DeletionError("owner_mismatch");
}
export async function executeDeletion(adapter: DeletionAdapter, identity: Proof, now = Date.now()) {
  if (!await adapter.exists(identity.owner)) return { status: "deleted" as const, requestId: identity.requestId };
  // A lost successful response must remain recoverable after the one-hour write
  // authority expires. The old signed proof can only establish absence; it must
  // never start/resume a deletion or disclose account data after expiry.
  if (identity.expires <= now) throw new DeletionError("receipt_expired");
  await adapter.begin(identity.owner, identity.requestId);
  let empty = false;
  // The service-only metadata reader returns full keys, including old deeply
  // nested objects. Each retry advances by deleting another batch, with no
  // fragile folder-depth cap or skip-prone offset after deletion.
  for (let batch = 0; batch < 24; batch++) {
    const files = await adapter.files(identity.owner, identity.requestId);
    if (!files.length) { empty = true; break; }
    if (files.length > 100 || files.some(path => !path.startsWith(`${identity.owner}/`))) throw new DeletionError("pending");
    await adapter.remove(files);
  }
  if (!empty) throw new DeletionError("pending");
  await adapter.deleteUser(identity.owner);
  if (await adapter.exists(identity.owner)) throw new DeletionError("pending");
  return { status: "deleted" as const, requestId: identity.requestId };
}
