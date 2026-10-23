import { CoachHistoryClient, type HistoryIO } from "@liftcut/core/coach-history-client";
import { apiBase, apiHeaders } from "./api";

export type HistoryAuth = { access_token: string; user: { id: string } };
/** Only the transport/storage differ. The web and phone share the same history queue. */
export function mobileHistory(owner: string, en: boolean, storage: HistoryIO["storage"], uuid: () => string,
  credentials: () => HistoryAuth | null, fetcher: typeof fetch = fetch) {
  const controllers = new Set<AbortController>();
  return new CoachHistoryClient(owner, en, {
    storage, uuid, online: () => true, activate() {}, dispose: () => { for (const c of controllers) c.abort(); controllers.clear(); },
    request: async (suffix, options = {}) => {
      const auth = credentials(); if (auth?.user.id !== owner) throw Error("ACCOUNT_CHANGED");
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetcher(`${apiBase}/api/coach/history${suffix}`, { ...options, cache: "no-store", signal: controller.signal, headers: apiHeaders(auth, true) });
        if (!r.ok) throw Error(r.status === 404 ? "NOT_FOUND" : r.status === 401 ? "AUTH" : r.status === 409 ? "HISTORY_CONFLICT" : "HISTORY_UNAVAILABLE");
        const body: unknown = await r.json(); if (credentials()?.user.id !== owner) throw Error("ACCOUNT_CHANGED");
        return body;
      } finally { clearTimeout(timer); controllers.delete(controller); }
    },
  });
}
