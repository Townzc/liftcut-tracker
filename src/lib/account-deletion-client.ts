import { createClient } from "@supabase/supabase-js";
import { AccountDeletion, type FreshDeletionAuth } from "@liftcut/core/account-deletion-client";
import { getSupabaseBrowserClient } from "./supabase/client";
import { getSupabaseEnv } from "./supabase/env";
import { ownerLifecycle, OWNER_LIFECYCLE_EVENT } from "./owner-lifecycle";
import { removeDeletedOutbox } from "@/services/today/outbox-storage";

export async function deletionAvailable() {
  const response = await fetch("/api/account/deletion", { cache: "no-store" });
  return response.ok && (await response.json()).available === true;
}
async function request(method: "POST" | "DELETE", owner: string, body: unknown, token?: string) {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || (data.session && data.session.user.id !== owner)) throw Error("ACCOUNT_CHANGED");
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 65000);
  try {
    const response = await fetch("/api/account/deletion", { method, signal: abort.signal, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Workout-Owner": owner, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw Error(["receipt_expired", "reauthenticate", "owner_mismatch"].includes(value.error) ? value.error : "OUTCOME_UNKNOWN");
    return value;
  } finally { clearTimeout(timer); }
}
export function browserDeletion(currentOwner: () => string | undefined) {
  const stops = new Map<string, Promise<void>>();
  return new AccountDeletion({ currentOwner, uuid: () => crypto.randomUUID(),
    store: { getAllKeys: async () => Object.keys(localStorage), getItem: async key => localStorage.getItem(key),
      setItem: async (key, value) => { localStorage.setItem(key, value); window.dispatchEvent(new Event(OWNER_LIFECYCLE_EVENT)); },
      removeItem: async key => { localStorage.removeItem(key); window.dispatchEvent(new Event(OWNER_LIFECYCLE_EVENT)); } },
    runtime: { block: owner => { const stopped = ownerLifecycle.stop(owner); stops.set(owner, stopped); void stopped.catch(() => {}); },
      idle: async owner => { await stops.get(owner); await ownerLifecycle.settled(owner); } },
    api: { begin: (owner, token, requestId) => request("POST", owner, { requestId, confirmed: true }, token),
      resume: (owner, receipt) => request("DELETE", owner, { receipt }) },
    purge: owner => ownerLifecycle.purge({ status: "deleted", owner }, removeDeletedOutbox),
    signOut: async owner => {
      const auth = getSupabaseBrowserClient().auth, { data, error } = await auth.getSession();
      if (error) throw Error("AUTH");
      if (data.session?.user.id === owner) { const result = await auth.signOut({ scope: "local" }); if (result.error) throw Error("AUTH"); }
    },
  });
}
/** Password verification never changes the normal browser session or its cookies. */
export async function freshPassword(owner: string, email: string, password: string): Promise<FreshDeletionAuth> {
  const { url, anonKey } = getSupabaseEnv(), client = createClient(url, anonKey, { auth: {
    storageKey: "liftcut-delete-reauth", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const close = async () => { await client.auth.signOut({ scope: "local" }); };
  try {
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error || !result.data.session || result.data.user?.id !== owner) throw Error("AUTH");
    const verified = await client.auth.getUser(result.data.session.access_token);
    if (verified.error || verified.data.user?.id !== owner) throw Error("AUTH");
    return { owner, token: result.data.session.access_token, close };
  } catch { await close().catch(() => {}); throw Error("AUTH"); }
}
/** OAuth users may explicitly confirm again after signing in; the API enforces fresh signed AMR. */
export async function freshCurrentSession(owner: string): Promise<FreshDeletionAuth> {
  const auth = getSupabaseBrowserClient().auth, { data, error } = await auth.getSession();
  if (error || data.session?.user.id !== owner) throw Error("AUTH");
  const verified = await auth.getUser(data.session.access_token);
  if (verified.error || verified.data.user?.id !== owner) throw Error("AUTH");
  return { owner, token: data.session.access_token, close: async () => {} };
}
