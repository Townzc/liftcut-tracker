import { COACH_CONSENT_VERSION } from "@liftcut/core/coach-chat";
import { coachRequestSchema, coachResponseSchema, type CoachInput, type CoachResponse } from "@liftcut/core/coach-contract";
import { COACH_STREAM_TYPE, coachStreamParser } from "@liftcut/core/coach-stream";
import { ApiError, apiBase, apiHeaders } from "./api";

export type CoachReply = CoachResponse;
type Credentials = Parameters<typeof apiHeaders>[0];

/**
 * One turn with the coach through the web's streaming endpoint, with the bearer token.
 * `onText` gets the reply as it grows; only a complete, validated result is returned.
 */
export async function askCoach(auth: Credentials, input: CoachInput,
  onText: (text: string) => void, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CoachReply> {
  const response = await fetcher(`${apiBase}/api/ai/coach`, { method: "POST", signal, headers: { ...apiHeaders(auth, true), Accept: COACH_STREAM_TYPE },
    body: JSON.stringify(coachRequestSchema.parse({ ...input, consent: COACH_CONSENT_VERSION })) });
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
      if (done) {
        const parsed = coachResponseSchema.safeParse(parser.end());
        if (!parsed.success) throw new Error("STREAM_INVALID");
        const reply = parsed.data, p = reply.proposal;
        if ((p?.kind === "workout" || p?.kind === "workoutReview") && p.session.userId !== auth.user.id) throw new Error("ACCOUNT_CHANGED");
        if (p?.kind === "workoutReview" && p.review.conversationId !== input.conversationId) throw new Error("CONVERSATION_CHANGED");
        return reply;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
