import {requireApiUser} from "@/app/api/ai/_lib";
import {workoutOwnerMismatch} from "@/lib/workout-owner";
import {CoachStore} from "@/services/ai/coach-store";
import {todayPool} from "@/services/today/database";
export const runtime="nodejs";
export async function GET(request:Request){
  const headers={"Cache-Control":"no-store"};
  try{
    const auth=await requireApiUser();if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    return Response.json(await new CoachStore(todayPool()).memory(auth.user.id,"9999-12-31"),{headers});
  }catch{return Response.json({error:"MEMORY_UNAVAILABLE"},{status:503,headers});}
}
