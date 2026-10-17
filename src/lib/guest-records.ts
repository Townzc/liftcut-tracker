import {guestFactsSchema,personalCommandSchema,type PersonalCommand,type PersonalRecord} from "./personal-records";

export const GUEST_RECORD_PREFIX="liftcut-guest-record-v1:";
export const GUEST_RECORD_EVENT="liftcut-guest-records-changed";
const workspaceKey="liftcut-guest-workspace-v1";
export function guestWorkspace():string {
  const existing=localStorage.getItem(workspaceKey);
  if(existing)return existing;
  const id=crypto.randomUUID();localStorage.setItem(workspaceKey,id);
  if(localStorage.getItem(workspaceKey)!==id)throw new Error("STORAGE_UNAVAILABLE");
  return id;
}
export function guestRecords():PersonalRecord[]{
  const events=Object.keys(localStorage).filter(k=>k.startsWith(GUEST_RECORD_PREFIX)).map(k=>{
    const raw=JSON.parse(localStorage.getItem(k)!);
    return {command:personalCommandSchema.parse(raw.command),createdAt:String(raw.createdAt)};
  });
  return events.filter(e=>e.command.action==="create").map(e=>{
    const c=e.command as Extract<PersonalCommand,{action:"create"}>;
    const undo=events.find(u=>u.command.action==="undo"&&u.command.recordId===c.id);
    return {id:c.id,entry:c.entry,source:c.source,text:c.text,createdAt:e.createdAt,
      undo:undo?{id:undo.command.id,createdAt:undo.createdAt}:null};
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
}
export function activeGuestFacts(){return guestFactsSchema.parse(guestRecords().filter(r=>!r.undo));}
export function saveGuestCommand(input:PersonalCommand,notify=true){
  guestWorkspace();const command=personalCommandSchema.parse(input),key=GUEST_RECORD_PREFIX+command.id;
  const existing=localStorage.getItem(key);
  if(existing){
    if(JSON.stringify(JSON.parse(existing).command)!==JSON.stringify(command))throw new Error("CONFLICT");
    return;
  }
  if(command.action==="undo"&&!guestRecords().some(r=>r.id===command.recordId&&!r.undo))throw new Error("RECORD_NOT_FOUND");
  const body=JSON.stringify({command,createdAt:new Date().toISOString()});
  localStorage.setItem(key,body);
  if(localStorage.getItem(key)!==body)throw new Error("STORAGE_UNAVAILABLE");
  if(notify)window.dispatchEvent(new Event(GUEST_RECORD_EVENT));
}
export function clearImportedGuestFacts(ids:string[]){
  const selected=new Set(ids);
  for(const key of Object.keys(localStorage).filter(k=>k.startsWith(GUEST_RECORD_PREFIX))){
    const {command}=JSON.parse(localStorage.getItem(key)!);
    if(selected.has(command.id)||(command.action==="undo"&&selected.has(command.recordId)))localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(GUEST_RECORD_EVENT));
}
export function nextGuestWorkspace(){localStorage.setItem(workspaceKey,crypto.randomUUID());}
