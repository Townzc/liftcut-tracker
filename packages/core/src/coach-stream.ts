/**
 * Framing of the coach's NDJSON reply stream, shared by the web and the mobile app.
 * Each platform reads and decodes bytes itself and feeds the text here.
 */
export const COACH_STREAM_TYPE = "application/x-ndjson";
export type CoachStreamEvent<R = unknown> =
  | { type: "status"; stage: "connecting" | "reading" | "drafting" }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "result"; result: R }
  | { type: "error"; error: string };
type Result = { requestId: string; message: string; sources: unknown[] };

/**
 * A terminal result is mandatory: truncation or cancellation never becomes a completed
 * reply or an actionable proposal. Wire text is incremental; `onEvent` receives the
 * accumulated display text (at most 2400 characters).
 */
export function coachStreamParser<R extends Result>(requestId: string, onEvent: (event: CoachStreamEvent<R>) => void) {
  let buffer = "", text = "", result: R | undefined;
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        if (result) throw new Error("STREAM_INVALID");
        const event = JSON.parse(line) as CoachStreamEvent<R>;
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") {
          if (event.result?.requestId !== requestId || typeof event.result.message !== "string" || !Array.isArray(event.result.sources)) throw new Error("STREAM_INVALID");
          result = event.result; continue;
        }
        if (event.type === "text" && typeof event.text === "string" && text.length + event.text.length <= 2400) {
          text += event.text; onEvent({ type: "text", text });
        } else if (event.type === "reset") { text = ""; onEvent({ type: "text", text }); }
        else if (event.type === "status" && ["connecting", "reading", "drafting"].includes(event.stage)) onEvent(event);
        else throw new Error("STREAM_INVALID");
      }
    },
    end(): R {
      if (result && !buffer.trim()) return result;
      throw new Error("STREAM_INCOMPLETE");
    },
  };
}
