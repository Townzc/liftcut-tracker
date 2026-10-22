import type { TodayData } from "@liftcut/core/today";
import { z } from "zod";
import { ApiError, apiBase, apiHeaders, getJson, sessionSchema, todaySchema } from "./api";
import type { Confirmed, OutboxApi } from "./outbox";

// Same endpoints as the web outbox: sentence commands and their undo have their own route.
const endpoint = (action: string) => action === "apply" || action === "undo" || action === "review" ? "/api/workout-commands" : "/api/workout-sessions";
const commandResult = z.looseObject({ session: sessionSchema, receipts: z.array(z.looseObject({ id: z.string() })) });

type Credentials = { access_token: string; user: { id: string } };
/** Reads the current token on every call, so a refreshed session keeps syncing the same queue. */
export function outboxApi(credentials: () => Credentials | null): OutboxApi {
  const auth = () => { const c = credentials(); if (!c) throw new ApiError(401, "SIGNED_OUT"); return c; };
  return {
    today: async () => await getJson("/api/workout-sessions", auth(), todaySchema) as unknown as TodayData,
    async send(action, bodyJson) {
      const response = await fetch(`${apiBase}${endpoint(action)}?action=${action}`, { method: "POST", headers: apiHeaders(auth(), true), body: bodyJson });
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) return { ok: false, status: response.status, code: typeof body.error === "string" ? body.error : `HTTP_${response.status}` };
      return { ok: true, value: (endpoint(action) === "/api/workout-commands" ? commandResult : sessionSchema).parse(body) as unknown as Confirmed };
    },
  };
}
