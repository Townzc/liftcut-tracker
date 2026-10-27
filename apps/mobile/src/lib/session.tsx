import type { Session } from "@supabase/supabase-js";
import { createContext, use, useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { supabase } from "./supabase";
import { cancelEmailSignup } from "./email-signup-native";

const SessionContext = createContext<{ session: Session | null; loading: boolean; getAuth: () => Session | null } | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState({ session: null as Session | null, loading: !!supabase });
  const current = useRef<Session | null>(null), getAuth = useCallback(() => current.current, []);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const update = (session: Session | null) => { current.current = session; setState({ session, loading: false }); };
    supabase.auth.getSession().then(({ data }) => { if (active) update(data.session); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // No Auth calls inside its listener; cancellation invalidates immediately, then clears storage.
      if (session || event === "SIGNED_OUT") void cancelEmailSignup().catch(() => console.warn("Pending signup cleanup failed"));
      update(session);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return <SessionContext.Provider value={{ ...state, getAuth }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
