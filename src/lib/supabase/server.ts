import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { bearerToken } from "@/lib/supabase/bearer";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

/**
 * The request's user, verified by Supabase Auth. The mobile app sends
 * `Authorization: Bearer <access token>`; the web app sends cookies. A request
 * with an Authorization header never falls back to cookies, so a bad token is
 * rejected even when a browser session exists.
 */
export async function getRequestUser(observe?: (stage: "client" | "request", ms: number) => void): Promise<{ supabase: SupabaseClient; user: User | null; bearer: boolean }> {
  const started = performance.now();
  const authorization = (await headers()).get("authorization");
  if (authorization === null) {
    const supabase = await getSupabaseServerClient();
    observe?.("client", performance.now() - started); const fetched = performance.now();
    const { data: { user }, error } = await supabase.auth.getUser();
    observe?.("request", performance.now() - fetched);
    return { supabase, user: error ? null : user, bearer: false };
  }
  const token = bearerToken(authorization), { url, anonKey } = getSupabaseEnv();
  // Data reads through this client run under the token's own row-level security.
  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token ?? "invalid"}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  observe?.("client", performance.now() - started); const fetched = performance.now();
  const { data: { user }, error } = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: true };
  observe?.("request", performance.now() - fetched);
  return { supabase, user: error ? null : user, bearer: true };
}
