import { z } from "zod";
import {guestFactsSchema, type PersonalCommand} from "./personal-records";
import type { LogDraft } from "@liftcut/core/workout-log-parser";
import type { WorkoutOperation } from "@liftcut/core/workout-outbox";
import type { Session } from "@liftcut/core/today";
import type { RunView } from "@liftcut/core/agent-contracts";
import type { CoachTiming } from "./coach-timing";

export const COACH_CONSENT_VERSION = "coach-model-v1";
export const coachMessageSchema = z.object({role:z.enum(["user","assistant"]),content:z.string().min(1).max(2400)}).strict();
export const coachRequestSchema = z.object({
  id:z.uuid(), text:z.string().trim().min(1).max(400),
  history:z.array(coachMessageSchema).max(12), locale:z.enum(["zh","en"]),
  timezone:z.string().max(100).refine(v=>{try {new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}}),
  consent:z.literal(COACH_CONSENT_VERSION), selectedExerciseId:z.string().max(150).optional(), planRunId:z.uuid().optional(),
  guestRecords:guestFactsSchema.optional(),
}).strict();
export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type CoachSource = {id:string;topic:string;from:string;to:string;readAt:string;rows:Record<string,unknown>[];summary:Record<string,unknown>;truncated:boolean};
export type CoachProposal =
  | {kind:"personal";command:Extract<PersonalCommand,{action:"create"}>}
  | {kind:"workout";session:Session;hash:string;draft:LogDraft;operation:WorkoutOperation}
  | {kind:"plan";run:RunView};
export type CoachResponse = {message:string;model:string;provider:string;sources:CoachSource[];proposal?:CoachProposal;requestId:string;timing?:CoachTiming};
export type CoachStatus = {available:boolean;provider:string|null;model:string|null;consentVersion:typeof COACH_CONSENT_VERSION};

/** Current conversation only, bounded to six complete turns. Saved chat is not a facts cache. */
export function conversationHistory(turns:{text:string;lines?:string[];reply:string;pending?:boolean;interrupted?:boolean}[]):CoachMessage[] {
  return turns.filter(t=>!t.pending&&!t.interrupted).slice(-6).flatMap(t=>[
    {role:"user" as const,content:t.text.slice(0,400)},
    {role:"assistant" as const,content:(t.lines?.join("\n") || (t.reply === "personalQueued" || t.reply === "queued" ? "User confirmed a draft; its queue may still be pending. Read fresh records before asserting it is saved." : "No confirmed write. Prior draft may be closed.")).slice(0,2400)},
  ]);
}
