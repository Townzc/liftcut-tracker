import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { apiBase } from "./api";
import { ownerRuntime } from "./owner-runtime";
import { RecipientConsent } from "./recipient-consent";

const stores = new Map<string, { controller: RecipientConsent; users: number }>();
function retain(owner: string | undefined, store: { controller: RecipientConsent; users: number }) {
  store.users++; if (owner && store.users === 1) void store.controller.refresh();
  return () => { store.users--; queueMicrotask(() => {
    if (store.users === 0 && stores.get(owner ?? "") === store) stores.delete(owner ?? "");
  }); };
}
export function useRecipientConsent(owner: string | undefined) {
  const store = useMemo(() => {
    const id = owner ?? "", existing = stores.get(id); if (existing) return existing;
    const key = `liftcut-coach-consent:${id}`;
    const controller = new RecipientConsent({
      read: () => AsyncStorage.getItem(key),
      write: value => ownerRuntime.run(id, () => value ? AsyncStorage.setItem(key, value) : AsyncStorage.removeItem(key)),
      status: () => ownerRuntime.run(id, async signal => {
        const abort = new AbortController(), stop = () => abort.abort();
        signal.addEventListener("abort", stop); const timer = setTimeout(stop, 10000);
        try {
          const response = await fetch(`${apiBase}/api/ai/coach`, { cache: "no-store", signal: abort.signal });
          if (!response.ok) throw Error("STATUS_UNAVAILABLE");
          return await response.json();
        } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
      }),
    });
    const created = { controller, users: 0 }; stores.set(id, created); return created;
  }, [owner]);
  useEffect(() => retain(owner, store), [owner, store]);
  const state = useSyncExternalStore(store.controller.subscribe, store.controller.snapshot, store.controller.snapshot);
  return { ...state, controller: store.controller };
}
