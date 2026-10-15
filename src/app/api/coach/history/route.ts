import { z } from "zod";
import { requireApiUser } from "@/app/api/ai/_lib";
import { sameOrigin,boundedJson,errorResponse } from "@/services/agent/http";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { historyCursorSchema } from "@/lib/coach-history";
import { CoachHistoryStore,CoachHistoryError } from "@/services/ai/coach-history-store";
import { todayEnabled,todayPool } from "@/services/today/database";
export const runtime="nodejs";
const headers={"Cache-Control":"no-store"};
async function handle(request:Request){
  if(request.method!=="GET"&&!sameOrigin(request))return Response.json({error:"ORIGIN_REJECTED"},{status:403,headers});
  try{
    const auth=await requireApiUser();if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    if(!todayEnabled())return Response.json({error:"NOT_AVAILABLE"},{status:404,headers});
    const store=new CoachHistoryStore(todayPool()),url=new URL(request.url);
    if(request.method==="GET"){
      const id=url.searchParams.get("id"),cursor=url.searchParams.get("before"),before=cursor?historyCursorSchema.parse(JSON.parse(cursor)):undefined;
      return Response.json(id?await store.load(auth.user.id,id,before):await store.list(auth.user.id,before),{headers});
    }
    const data=await boundedJson(request);
    return Response.json(request.method==="POST"?await store.save(auth.user.id,data):await store.remove(auth.user.id,z.object({id:z.uuid()}).strict().parse(data).id),{headers});
  }catch(e){if(e instanceof CoachHistoryError)return Response.json({error:e.message},{status:e.message==="NOT_FOUND"?404:409,headers});return errorResponse(e);}
}
export const GET=handle,POST=handle,DELETE=handle;
