import type { Session } from "@supabase/supabase-js";
import { createContext, use, useEffect, useState, type PropsWithChildren } from "react";
import { supabase } from "./supabase";

const SessionContext = createContext<{ session: Session | null; loading: boolean } | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState({ session: null as Session | null, loading: !!supabase });
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setState({ session: data.session, loading: false }); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
