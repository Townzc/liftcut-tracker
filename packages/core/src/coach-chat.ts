/** Consent to send the data listed in model-data.ts to the coach model; asked again whenever that list grows. */
export const COACH_CONSENT_VERSION = "coach-model-v2";
export type CoachTurnMessage = { role: "user" | "assistant"; content: string };

/** Current conversation only, bounded to six complete turns. Saved chat is not a facts cache. */
export function conversationHistory(turns: { text: string; lines?: string[]; reply: string; pending?: boolean; interrupted?: boolean }[]): CoachTurnMessage[] {
  return turns.filter(t => !t.pending && !t.interrupted).slice(-6).flatMap(t => [
    { role: "user" as const, content: t.text.slice(0, 400) },
    { role: "assistant" as const, content: (t.lines?.join("\n") || (t.reply === "personalQueued" || t.reply === "queued" ? "User confirmed a draft; its queue may still be pending. Read fresh records before asserting it is saved." : "No confirmed write. Prior draft may be closed.")).slice(0, 2400) },
  ]);
}
