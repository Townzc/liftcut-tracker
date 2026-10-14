import { requireApiUser } from "@/app/api/ai/_lib";
import { boundedJson, sameOrigin } from "@/services/agent/http";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { coachRequestSchema } from "@/lib/coach-model";
import { coachStatus, runCoach } from "@/services/ai/coach-agent";
import { CoachReadError } from "@/services/ai/coach-store";
import { ZodError } from "zod";

export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"no-store"};
export async function GET(){return Response.json(coachStatus(),{headers});}
export async function POST(request:Request){
  if(!sameOrigin(request))return Response.json({error:"ORIGIN_REJECTED"},{status:403,headers});
  try{
    const auth=await requireApiUser();if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    const input=coachRequestSchema.parse(await boundedJson(request));
    if(!coachStatus().available)return Response.json({error:"MODEL_UNAVAILABLE"},{status:503,headers});
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(50000)]);
    return Response.json(await runCoach(auth.user.id,input,signal),{headers});
  }catch(e){
    if(e instanceof ZodError||e instanceof SyntaxError)return Response.json({error:"INVALID_REQUEST"},{status:400,headers});
    if(e instanceof CoachReadError)return Response.json({error:e.message},{status:e.message==="RATE_LIMITED"?429:409,headers:{...headers,"Retry-After":"60"}});
    if(e instanceof Error&&["REQUEST_TOO_LARGE","INVALID_JSON"].includes(e.message))return Response.json({error:e.message},{status:400,headers});
    console.warn("coach_model_failed",JSON.stringify({kind:e instanceof Error?e.name:"unknown"}));
    return Response.json({error:request.signal.aborted?"CANCELLED":"MODEL_UNAVAILABLE"},{status:503,headers});
  }
}
