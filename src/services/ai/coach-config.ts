import "server-only";
import { COACH_CONSENT_VERSION,type CoachStatus } from "@/lib/coach-model";
import { getAiProviderConfig } from "./config";
import { resolveAiRecipient } from "./recipient-policy";
export const coachModelName=(provider:string,model:string)=>provider==="deepseek"&&model==="deepseek-v4-flash"?"deepseek-flash":model;
/** Public capability flags must not import the model SDK, tool schemas or DB pools. */
export function coachStatus():CoachStatus{
  const c=getAiProviderConfig();return {available:!!c&&process.env.FEATURE_TODAY_SESSION==="true"&&!!process.env.WORKOUT_DATABASE_URL&&(process.env.COACH_SIGNING_SECRET?.length??0)>=32,
    provider:c?.provider??null,model:c?coachModelName(c.provider,c.model):null,consentVersion:COACH_CONSENT_VERSION,recipient:resolveAiRecipient(c)};
}
