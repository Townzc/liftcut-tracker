import { createClient } from "@supabase/supabase-js";
import { apiBase } from "./api";
import type { DeletionApi, FreshDeletionAuth } from "./account-deletion";

export function deletionApi(fetcher: typeof fetch = fetch) {
  const call = async (method: string, body?: unknown, headers?: Record<string, string>) => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 65000);
    try {
      const result = await fetcher(`${apiBase}/api/account/deletion`, { method, signal: abort.signal, cache: "no-store",
        headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await result.json();
      if (!result.ok) throw Error(value?.error === "owner_mismatch" ? "ACCOUNT_CHANGED"
        : ["receipt_expired", "invalid_receipt", "reauthenticate", "unavailable"].includes(value?.error) ? value.error : "OUTCOME_UNKNOWN");
      return value;
    } finally { clearTimeout(timer); }
  };
  return {
    available: async () => (await call("GET"))?.available === true,
    begin: (owner, token, requestId) => call("POST", { requestId, confirmed: true }, { Authorization: `Bearer ${token}`, "X-Workout-Owner": owner }),
    // Only the signed body receipt authorizes deletion; no Auth bearer is retained for retries.
    resume: (owner, receipt) => call("DELETE", { receipt }, { "X-LiftCut-Deletion-Receipt": "1", "X-Workout-Owner": owner }),
  } satisfies DeletionApi & { available(): Promise<boolean> };
}
/** Separate in-memory Auth client: password verification cannot replace the app's logged-in account. */
export async function freshDeletionAuth(owner: string, email: string, password: string,
  config = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY }, fetcher: typeof fetch = fetch): Promise<FreshDeletionAuth> {
  if (!config.url || !config.key) throw Error("AUTH");
  const isolated = createClient(config.url, config.key, { global: { fetch: fetcher },
    auth: { storageKey: "liftcut-deletion-reauth", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const close = async () => { await isolated.auth.signOut({ scope: "local" }); isolated.auth.stopAutoRefresh(); };
  try {
    const { data, error } = await isolated.auth.signInWithPassword({ email, password });
    if (error || !data.session || data.user?.id !== owner) throw Error("AUTH");
    const verified = await isolated.auth.getUser(data.session.access_token);
    if (verified.error || verified.data.user?.id !== owner) throw Error("AUTH");
    return { owner, token: data.session.access_token, close };
  } catch { await close().catch(() => {}); throw Error("AUTH"); }
}
