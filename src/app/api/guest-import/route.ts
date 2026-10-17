import {requireApiUser} from "@/app/api/ai/_lib";
import {boundedJson,sameOrigin} from "@/services/agent/http";
import {workoutOwnerMismatch} from "@/lib/workout-owner";
import {guestSession} from "@/services/ai/guest-session";
import {GuestStore,GuestError} from "@/services/ai/guest-store";
import {todayPool} from "@/services/today/database";
import {ZodError} from "zod";
export const runtime="nodejs";
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store"};
  if(!sameOrigin(request))return Response.json({error:"ORIGIN_REJECTED"},{status:403,headers});
  try{
    const auth=await requireApiUser();if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    const guest=await guestSession();if(!guest)return Response.json({error:"GUEST_SESSION_REQUIRED"},{status:401,headers});
    return Response.json(await new GuestStore(todayPool()).import(auth.user.id,guest,await boundedJson(request)),{headers});
  }catch(e){return Response.json({error:e instanceof GuestError?e.message:e instanceof ZodError?"INVALID_REQUEST":"IMPORT_UNAVAILABLE"},{status:e instanceof GuestError?409:e instanceof ZodError?400:503,headers});}
}
