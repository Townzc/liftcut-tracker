import { requireApiUser } from "@/app/api/ai/_lib";
import { boundedJson, sameOrigin } from "@/services/agent/http";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { coachRequestSchema } from "@/lib/coach-model";
import { coachStatus } from "@/services/ai/coach-config";
import { CoachReadError } from "@/services/ai/coach-store";
import { ZodError } from "zod";
import { COACH_STREAM_TYPE, type CoachStreamEvent } from "@/lib/coach-stream";
import { CoachTimer } from "@/lib/coach-timing";
import {coachFailureCode} from "@/lib/coach-failure";

export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"no-store"};
export async function GET(){return Response.json(coachStatus(),{headers});}
export async function POST(request:Request){
  const timer=new CoachTimer();
  if(!sameOrigin(request))return Response.json({error:"ORIGIN_REJECTED"},{status:403,headers});
  try{
    // Loading code is independent of identity; no model/database work starts before auth.
    const [auth,{runCoach}]=await Promise.all([
      timer.measure("auth",()=>requireApiUser((stage,ms)=>timer.auth(stage,ms))),
      timer.measure("bootstrap",()=>import("@/services/ai/coach-agent")),
    ]);if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    const input=coachRequestSchema.parse(await boundedJson(request));
    if(!coachStatus().available)return Response.json({error:"MODEL_UNAVAILABLE"},{status:503,headers});
    if(request.headers.get("Accept")?.includes(COACH_STREAM_TYPE)){
      const controller=new AbortController(),encoder=new TextEncoder();
      const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(50000)]);
      let closed=false;
      const body=new ReadableStream<Uint8Array>({
        start(stream){
          const emit=(event:CoachStreamEvent)=>{if(!closed&&!signal.aborted)stream.enqueue(encoder.encode(JSON.stringify(event)+"\n"));};
          emit({type:"status",stage:"connecting"});
          void runCoach(auth.user.id,input,signal,undefined,emit,timer).then(result=>emit({type:"result",result})).catch(error=>{
            console.warn("coach_stream_failed",JSON.stringify({kind:error instanceof Error?error.name:"unknown",timing:timer.snapshot()}));
            emit({type:"error",error:error instanceof CoachReadError?error.message:coachFailureCode(error)});
          }).finally(()=>{if(!closed){closed=true;stream.close();}});
        },
        cancel(){closed=true;controller.abort();},
      });
      return new Response(body,{headers:{"Content-Type":`${COACH_STREAM_TYPE}; charset=utf-8`,"Cache-Control":"no-store, no-transform","X-Accel-Buffering":"no","Server-Timing":`auth;dur=${timer.snapshot().authMs??0}, ready;dur=${timer.elapsed()}`}});
    }
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(50000)]);
    return Response.json(await runCoach(auth.user.id,input,signal,undefined,undefined,timer),{headers});
  }catch(e){
    if(e instanceof ZodError||e instanceof SyntaxError)return Response.json({error:"INVALID_REQUEST"},{status:400,headers});
    if(e instanceof CoachReadError)return Response.json({error:e.message},{status:e.message==="RATE_LIMITED"?429:409,headers:{...headers,"Retry-After":"60"}});
    if(e instanceof Error&&["REQUEST_TOO_LARGE","INVALID_JSON"].includes(e.message))return Response.json({error:e.message},{status:400,headers});
    console.warn("coach_model_failed",JSON.stringify({kind:e instanceof Error?e.name:"unknown",timing:timer.snapshot()}));
    return Response.json({error:request.signal.aborted?"CANCELLED":coachFailureCode(e)},{status:503,headers});
  }
}
