import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CoachHistoryClient } from "@liftcut/core/coach-history-client";
import { randomUUID } from "expo-crypto";
import { createContext, use, useEffect, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import { mobileHistory, type HistoryAuth } from "./coach-history";
import { useI18n } from "./i18n";
import { useSession } from "./session";

const History = createContext<CoachHistoryClient | null>(null);
// Lives with the signed-in app, not an individual screen: leaving retains drafts;
// signing out disposes the queue and erases cache after any pending local writes.
export function CoachHistoryProvider({ children }: PropsWithChildren) {
  const { session, getAuth } = useSession();
  return session ? <AccountHistory key={session.user.id} owner={session.user.id} getAuth={getAuth}>{children}</AccountHistory> : children;
}
function AccountHistory({ owner, getAuth, children }: PropsWithChildren<{ owner: string; getAuth: () => HistoryAuth | null }>) {
  const { locale } = useI18n(), [history] = useState(() => mobileHistory(owner, locale === "en", AsyncStorage, randomUUID, getAuth));
  useEffect(() => {
    void history.activate();
    const listener = AppState.addEventListener("change", value => { if (value === "active") void history.flush(); });
    return () => { listener.remove(); history.dispose(); };
  }, [history]);
  return <History.Provider value={history}>{children}</History.Provider>;
}
export function useCoachHistory() { const value = use(History); if (!value) throw Error("CoachHistoryProvider required"); return value; }
