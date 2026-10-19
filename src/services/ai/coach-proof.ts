import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { workoutCanonical } from "@liftcut/core/workout-context";

export type ModelProvenance={provider:string;model:string;sourceTexts:string[];version:"coach-v1"};
// Only the literal spans used by this confirmed draft, never a whole chat history.
const metadataSchema=z.object({provider:z.string().max(80),model:z.string().max(160),sourceTexts:z.array(z.string().max(400)).max(20),version:z.literal("coach-v1")}).strict();
function secret(){const value=process.env.COACH_SIGNING_SECRET;if(!value||value.length<32)throw new Error("COACH_NOT_CONFIGURED");return value;}
const mac=(v:string)=>createHmac("sha256",secret()).update("liftcut-coach-proposal-v1\n"+v).digest();
export function signCoachProposal(owner:string,binding:unknown,metadata:ModelProvenance,now=Date.now()):string {
  const payload=Buffer.from(JSON.stringify({owner,binding,metadata:metadataSchema.parse(metadata),expires:now+7*86400000})).toString("base64url");
  return payload+"."+mac(payload).toString("base64url");
}
export function verifyCoachProposal(owner:string,binding:unknown,token:string,now=Date.now()):ModelProvenance {
  const parts=token.split(".");if(parts.length!==2||token.length>24000)throw new Error("MODEL_PROPOSAL_INVALID");
  const signature=Buffer.from(parts[1],"base64url"),expected=mac(parts[0]);
  if(signature.length!==expected.length||!timingSafeEqual(signature,expected))throw new Error("MODEL_PROPOSAL_INVALID");
  const payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
  if(payload.owner!==owner||workoutCanonical(payload.binding)!==workoutCanonical(binding))throw new Error("MODEL_PROPOSAL_INVALID");
  if(!Number.isSafeInteger(payload.expires)||payload.expires<now)throw new Error("MODEL_PROPOSAL_EXPIRED");
  return metadataSchema.parse(payload.metadata);
}
