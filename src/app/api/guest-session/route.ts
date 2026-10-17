import {sameOrigin} from "@/services/agent/http";
import {guestSession} from "@/services/ai/guest-session";
import {GuestStore} from "@/services/ai/guest-store";
import {todayPool} from "@/services/today/database";
export const runtime="nodejs";
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store"};
  if(!sameOrigin(request))return Response.json({error:"ORIGIN_REJECTED"},{status:403,headers});
  try{return Response.json(await new GuestStore(todayPool()).quota((await guestSession(true))!),{headers});}
  catch{return Response.json({error:"GUEST_UNAVAILABLE"},{status:503,headers});}
}
