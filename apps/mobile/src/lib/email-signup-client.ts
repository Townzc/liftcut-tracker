import { createClient } from "@supabase/supabase-js";
import { prepareNativeSignupPkce, requireSignupCrypto, requireSignupS256, type NativeSignupCrypto } from "./signup-crypto";

export type EmailStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export type SignupAuthPort = { send(email: string, password: string, redirect: string): Promise<void>;
  verify(code: string): Promise<{ email?: string; email_confirmed_at?: string }>; cancel(): void; close(): Promise<void> };
export type SignupAuthFactory = (key: string, storage: EmailStorage) => SignupAuthPort;

/** No React Native dependency: local Auth acceptance uses the identical SDK adapter. */
export function signupAuthFactory(url: string, anonKey: string, nativeCrypto?: NativeSignupCrypto,
  request: typeof fetch = (input, init) => fetch(input, init)): SignupAuthFactory {
  return (key, storage) => {
    let abort = new AbortController(), hasSession = false, sending = false;
    let digest: Awaited<ReturnType<typeof requireSignupCrypto>> | undefined;
    let unexpectedToken: string | undefined;
    const guardedFetch: typeof fetch = async (input, init) => {
      const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (sending || target.pathname === "/auth/v1/signup") {
        if (!digest || target.origin !== new URL(url).origin || target.pathname !== "/auth/v1/signup" || init?.method !== "POST") throw new Error("signup_pkce_rejected");
        await requireSignupS256(init.body, await storage.getItem(`${key}-code-verifier`), digest);
      }
      return request(input, { ...init, signal: abort.signal, redirect: "error" });
    };
    const client = createClient(url, anonKey, { auth: { storageKey: key, storage, flowType: "pkce",
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } });
    return {
      async send(email, password, emailRedirectTo) {
        // The SDK otherwise falls back to Math.random / plain PKCE on some runtimes.
        const prepared = nativeCrypto ? await prepareNativeSignupPkce(nativeCrypto) : null;
        digest = prepared?.digest ?? await requireSignupCrypto();
        if (abort.signal.aborted) throw new Error("signup_cancelled");
        sending = true;
        try {
          if (prepared) {
            await storage.setItem(`${key}-code-verifier`, JSON.stringify(prepared.verifier));
            if (abort.signal.aborted) throw new Error("signup_cancelled");
            // Auth's public signup contract; exchange/identity/session cleanup still use the isolated SDK.
            const target = new URL("/auth/v1/signup", url); target.searchParams.set("redirect_to", emailRedirectTo);
            const response = await guardedFetch(target.href, { method: "POST", headers: {
              apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json",
            }, body: JSON.stringify({ email, password, data: {}, code_challenge: prepared.challenge, code_challenge_method: "s256" }) });
            const result = await response.json();
            unexpectedToken = typeof result?.access_token === "string" ? result.access_token : undefined;
            if (!response.ok || unexpectedToken || typeof result?.id !== "string" || result?.email !== email
              || result?.email_confirmed_at || result?.confirmed_at || result?.refresh_token) throw new Error("signup_confirmation_required");
            return;
          }
          const result = await client.auth.signUp({ email, password, options: { emailRedirectTo } });
          hasSession = !!result.data.session;
          if (result.error || hasSession) throw new Error("signup_confirmation_required");
        } finally { sending = false; }
      },
      async verify(code) {
        const result = await client.auth.exchangeCodeForSession(code);
        hasSession = !!result.data.session;
        if (result.error || !hasSession) throw new Error("signup_code_rejected");
        const identity = await client.auth.getUser();
        if (identity.error || !identity.data.user) throw new Error("signup_identity_rejected");
        return { email: identity.data.user.email, email_confirmed_at: identity.data.user.email_confirmed_at };
      },
      cancel() { abort.abort(); },
      async close() {
        abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 5000);
        try {
          if (unexpectedToken) await client.auth.admin.signOut(unexpectedToken, "local").catch(() => undefined);
          if (hasSession) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
        } finally { unexpectedToken = undefined; clearTimeout(timer); await client.auth.dispose(); }
      },
    };
  };
}
