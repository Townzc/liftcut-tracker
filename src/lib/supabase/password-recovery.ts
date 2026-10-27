import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { isRecentRecovery } from "./recovery-policy";

const key = "liftcut-password-recovery", verifier = `${key}-code-verifier`;
let client: SupabaseClient | undefined;
function recoveryClient() {
  const { url, anonKey } = getSupabaseEnv();
  // The verifier can follow an email into another tab; the recovered session cannot.
  const storage = (name: string) => name === verifier ? localStorage : sessionStorage;
  return client ??= createClient(url, anonKey, { auth: { flowType: "pkce", storageKey: key,
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: name => storage(name).getItem(name), setItem: (name, value) => storage(name).setItem(name, value),
      removeItem: name => storage(name).removeItem(name) } } });
}
function clearStoredRecovery() {
  sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}-user`); localStorage.removeItem(verifier);
}
export async function sendRecoveryEmail(email: string) {
  clearStoredRecovery();
  const { error } = await recoveryClient().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error("recovery_email_failed");
}
async function verifiedIdentity() {
  const auth = recoveryClient().auth;
  const { data: { session }, error: sessionError } = await auth.getSession();
  if (sessionError || !session) throw new Error("recovery_required");
  const { data, error } = await auth.getClaims(session.access_token);
  if (error || !data || !isRecentRecovery(data.claims)) throw new Error("recovery_required");
  const { data: { user }, error: userError } = await auth.getUser(session.access_token);
  if (userError || !user || user.id !== data.claims.sub || user.id !== session.user.id) throw new Error("recovery_required");
  return { id: user.id, email: user.email ?? "" };
}
export async function openRecovery() {
  const url = new URL(window.location.href), code = url.searchParams.get("code");
  window.history.replaceState(null, "", "/reset-password");
  try {
    if (url.hash || url.searchParams.has("error") || (url.search && !code)) throw new Error("recovery_required");
    if (code) {
      const { error } = await recoveryClient().auth.exchangeCodeForSession(code);
      if (error) throw new Error("recovery_required"); // Never fall back to an older session after a failed exchange.
    }
    return await verifiedIdentity();
  } catch { clearStoredRecovery(); throw new Error("recovery_required"); }
}
export async function finishRecovery(password: string, owner: string) {
  const identity = await verifiedIdentity();
  if (identity.id !== owner) throw new Error("recovery_required");
  const { data, error } = await recoveryClient().auth.updateUser({ password });
  if (error || data.user?.id !== owner) throw new Error("password_update_failed");
  await cancelRecovery();
}
export async function cancelRecovery() {
  try { await recoveryClient().auth.signOut({ scope: "local" }); }
  catch { /* Still remove this browser's recovery material if transport fails. */ }
  finally { clearStoredRecovery(); }
}
