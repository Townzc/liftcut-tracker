import { COACH_CONSENT_VERSION, type CoachTurnMessage } from "@liftcut/core/coach-chat";
import { COACH_STREAM_TYPE, coachStreamParser } from "@liftcut/core/coach-stream";
import type { LogDraft } from "@liftcut/core/workout-log-parser";
import type { WorkoutOperation } from "@liftcut/core/workout-outbox";
import { z } from "zod";
import { ApiError, apiBase, apiHeaders } from "./api";

// Only what the screen uses is checked; a workout draft's operation is queued exactly as the server built it, as on the web.
const source = z.looseObject({ id: z.string(), topic: z.string(), from: z.string(), to: z.string(), rows: z.array(z.unknown()) });
const proposal = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("workout"), hash: z.string(), draft: z.custom<LogDraft>(v => !!v && typeof v === "object"),
    operation: z.custom<WorkoutOperation>(v => !!v && typeof v === "object" && "action" in v && "body" in v) }),
  z.looseObject({ kind: z.literal("personal") }), z.looseObject({ kind: z.literal("plan") }),
]);
const replySchema = z.looseObject({ requestId: z.string(), message: z.string(), sources: z.array(source), proposal: proposal.optional() });
export type CoachReply = z.infer<typeof replySchema>;
type Credentials = Parameters<typeof apiHeaders>[0];

/**
 * One turn with the coach through the web's streaming endpoint, with the bearer token.
 * `onText` gets the reply as it grows; only a complete, validated result is returned.
 */
export async function askCoach(auth: Credentials, input: { id: string; text: string; history: CoachTurnMessage[]; locale: "zh" | "en"; timezone: string },
  onText: (text: string) => void, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CoachReply> {
  const response = await fetcher(`${apiBase}/api/ai/coach`, { method: "POST", signal, headers: { ...apiHeaders(auth, true), Accept: COACH_STREAM_TYPE },
    body: JSON.stringify({ ...input, consent: COACH_CONSENT_VERSION }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new ApiError(response.status, typeof body.error === "string" ? body.error : `HTTP_${response.status}`);
  }
  if (!response.body) throw new Error("STREAM_INCOMPLETE");
  const parser = coachStreamParser<CoachReply>(input.id, event => { if (event.type === "text") onText(event.text); });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { size += value.length; if (size > 1024 * 1024) throw new Error("STREAM_TOO_LARGE"); parser.push(value); }
      if (done) return replySchema.parse(parser.end());
    }
  } finally { await reader.cancel().catch(() => {}); }
}
