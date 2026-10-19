import type { CoachResponse } from "./coach-model";
import { coachStreamParser, type CoachStreamEvent as Event } from "@liftcut/core/coach-stream";

export { COACH_STREAM_TYPE } from "@liftcut/core/coach-stream";
export type CoachStreamEvent = Event<CoachResponse>;

/** Only the explicitly framed reply string can be shown. Never parse plan/tool JSON
 * as prose. Source IDs precede the message so callers can verify them first. */
export function streamingReply(input:string):{text:string;sourceIds:string[]}|null {
  if(input.length>20000)return null;
  const prefix=/^\s*\{\s*"sourceIds"\s*:\s*(\[(?:\s|"(?:[^"\\]|\\.)*"|,)*\])\s*,\s*"message"\s*:\s*"/.exec(input);
  if(!prefix)return null;
  let sourceIds:unknown;
  try{sourceIds=JSON.parse(prefix[1]);}catch{return null;}
  if(!Array.isArray(sourceIds)||sourceIds.length>4||sourceIds.some(id=>typeof id!=="string"||id.length>100))return null;
  let encoded="";
  for(let i=prefix[0].length;i<input.length;i++){
    const c=input[i];
    if(c==='"')break;
    if(c==="\\"){
      if(i+1>=input.length)break;
      const length=input[i+1]==="u"?6:2;
      if(i+length>input.length)break;
      encoded+=input.slice(i,i+length);i+=length-1;
    }else encoded+=c;
  }
  try{
    // JSON.parse handles escapes; hold back an incomplete UTF-16 surrogate pair.
    const text=(JSON.parse('"'+encoded+'"') as string).replace(/[\uD800-\uDBFF]$/,"");
    return text.length<=2400?{text,sourceIds:sourceIds as string[]}:null;
  }catch{return null;}
}

/** Reads the response bytes into the shared parser; the caller owns the abort signal. */
export async function consumeCoachStream(response:Response,requestId:string,onEvent:(event:CoachStreamEvent)=>void,signal:AbortSignal):Promise<CoachResponse>{
  if(!response.body)throw new Error("STREAM_INCOMPLETE");
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true}),parser=coachStreamParser<CoachResponse>(requestId,onEvent);
  let bytes=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener("abort",abort,{once:true});
  try{
    while(true){
      signal.throwIfAborted();
      const {done,value}=await reader.read();
      signal.throwIfAborted();
      bytes+=value?.byteLength??0;
      if(bytes>1024*1024)throw new Error("STREAM_TOO_LARGE");
      parser.push(decoder.decode(value,{stream:!done}));
      if(done)return parser.end();
    }
  }finally{signal.removeEventListener("abort",abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
