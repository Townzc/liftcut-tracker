import { z } from "zod";

export const MOBILE_EMAIL_CALLBACK_PATH = "/auth/mobile-callback";
export const MOBILE_EMAIL_APP_CALLBACK = "liftcut://auth/callback";
// Local pending-request lifetime, distinct from the provider's one-use code expiry.
export const MOBILE_SIGNUP_TTL_MS = 30 * 60 * 1000;
const attemptId = z.string().uuid();
const callbackSchema = z.object({
  attempt: attemptId, code: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  lang: z.enum(["zh-CN", "en"]).default("zh-CN"),
}).strict();
export type MobileEmailCallback = z.infer<typeof callbackSchema>;

/** Closed query contract; do not accept tokens, next URLs, errors or duplicate keys. */
export function parseMobileEmailParams(entries: readonly (readonly [string, string])[]): MobileEmailCallback | null {
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (!["attempt", "code", "lang"].includes(key) || Object.hasOwn(values, key)) return null;
    values[key] = value;
  }
  const result = callbackSchema.safeParse(values);
  return result.success ? result.data : null;
}

export function mobileEmailAppLink(value: MobileEmailCallback): string {
  const callback = callbackSchema.parse(value);
  return `${MOBILE_EMAIL_APP_CALLBACK}?attempt=${encodeURIComponent(callback.attempt)}&code=${encodeURIComponent(callback.code)}&lang=${callback.lang}`;
}

const pendingSchema = z.object({
  version: z.literal(1), attempt: attemptId, email: z.string().trim().toLowerCase().email(),
  createdAt: z.number().int().nonnegative(),
  phase: z.enum(["waiting", "exchanging", "cancelled", "completed"]),
}).strict();
export type PendingEmailSignup = z.infer<typeof pendingSchema>;
export function readPendingEmailSignup(value: unknown): PendingEmailSignup | null {
  const parsed = pendingSchema.safeParse(value); return parsed.success ? parsed.data : null;
}
export const emailSignupStorageKey = (attempt: string) => `liftcut-email-signup-${attemptId.parse(attempt)}`;

export function newEmailSignup(email: string, attempt: string, now: number): PendingEmailSignup {
  return pendingSchema.parse({ version: 1, attempt, email, createdAt: now, phase: "waiting" });
}

/** Pure preparation only. The native adapter must serialize and persist next before exchanging. */
export function prepareEmailSignupExchange(value: unknown, callback: MobileEmailCallback, activeUserId: string | null, now: number) {
  const pending = pendingSchema.parse(value), parsed = callbackSchema.parse(callback);
  if (activeUserId !== null) throw new Error("already_signed_in"); // Never sign out another account.
  if (!Number.isSafeInteger(now) || now < pending.createdAt || now - pending.createdAt >= MOBILE_SIGNUP_TTL_MS) throw new Error("signup_expired");
  if (pending.phase !== "waiting" || pending.attempt !== parsed.attempt) throw new Error("signup_not_pending");
  return { next: { ...pending, phase: "exchanging" as const }, code: parsed.code,
    // Supabase's PKCE client must use this isolated storage key, never the ordinary session key.
    storageKey: emailSignupStorageKey(pending.attempt) };
}

/** Input must come from Auth getUser after PKCE exchange, never a URL or unverified JWT. */
export function requireSignupIdentity(pending: PendingEmailSignup, user: { email?: string; email_confirmed_at?: string }) {
  const expected = pendingSchema.parse(pending);
  if (expected.phase !== "exchanging" || !user.email_confirmed_at || user.email?.trim().toLowerCase() !== expected.email) throw new Error("signup_identity_mismatch");
  return { ...expected, phase: "completed" as const };
}
