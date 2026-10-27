import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/supabase/env";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabaseEnv();
  // Recovery has a separate PKCE client; the normal account must not consume its code.
  browserClient = createBrowserClient(url, anonKey, { auth: {
    detectSessionInUrl: typeof window === "undefined" || window.location.pathname !== "/reset-password",
  } });

  return browserClient;
}
