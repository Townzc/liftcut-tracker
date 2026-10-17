import "server-only";
import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {z} from "zod";
export const GUEST_SESSION_COOKIE="liftcut_ai_guest";
const lifetime=30*86400;
const payloadSchema=z.object({id:z.uuid(),expires:z.number().int()}).strict();
function mac(text:string){
  const secret=process.env.COACH_SIGNING_SECRET;
  if(!secret||secret.length<32)throw new Error("COACH_NOT_CONFIGURED");
  return createHmac("sha256",secret).update("liftcut-guest-v1\n"+text).digest();
}
export function signGuestSession(id:string,now=Date.now()){
  const payload=Buffer.from(JSON.stringify({id:z.uuid().parse(id),expires:now+lifetime*1000})).toString("base64url");
  return payload+"."+mac(payload).toString("base64url");
}
export function verifyGuestSession(token:string|undefined,now=Date.now()):string|null{
  if(!token||token.length>600)return null;
  try{
    const [body,sig,...rest]=token.split(".");if(rest.length||!body||!sig)return null;
    const expected=mac(body),actual=Buffer.from(sig,"base64url");
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
    const p=payloadSchema.parse(JSON.parse(Buffer.from(body,"base64url").toString("utf8")));
    return p.expires>now&&p.expires<=now+lifetime*1000?p.id:null;
  }catch{return null;}
}
export async function guestSession(create=false){
  const jar=await cookies(),old=verifyGuestSession(jar.get(GUEST_SESSION_COOKIE)?.value);
  if(old||!create)return old;
  const id=randomUUID();jar.set(GUEST_SESSION_COOKIE,signGuestSession(id),{httpOnly:true,secure:process.env.NODE_ENV==="production"&&!process.env.AUTH_FIXTURE_PORT,sameSite:"lax",path:"/",maxAge:lifetime});
  return id;
}
export function guestNetworkHash(request:Request,now=new Date()){
  // This header is supplied/overwritten by Vercel. Never trust arbitrary proxy
  // headers on other hosts; all local requests share a conservative budget.
  const network=process.env.VERCEL?request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()||"unknown":"local";
  return mac(`network:${now.toISOString().slice(0,10)}:${network}`).toString("hex");
}
