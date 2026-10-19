import { mergeConfirmed, operationBody, operationId, projectOperation, projectOutbox, retryDisposition,
  type OutboxItem, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";
import type { Session, TodayData } from "@liftcut/core/today";
import { OutboxStorage } from "./outbox-storage";
import { localContextHash } from "@/lib/workout-context";

const NOTICE="liftcut-workout-outbox-change";
export class WorkoutOutboxClient {
  private storage:OutboxStorage;
  private channel:BroadcastChannel | null=null;
  private running=false;
  private disposed=false;
  private request:AbortController | null=null;
  private timer:ReturnType<typeof setInterval> | null=null;
  constructor(readonly owner:string,private changed:(state:OutboxState)=>void,private problem:(code:string)=>void,
    private synced:()=>void) {
    this.storage=new OutboxStorage(owner);
  }
  private emit(state:OutboxState) {if (!this.disposed) this.changed(state);}
  private notify() {
    if(this.disposed)return;
    this.channel?.postMessage(this.owner);
    window.dispatchEvent(new CustomEvent(NOTICE,{detail:this.owner}));
  }
  private read=async()=>{try {this.emit(await this.storage.change());} catch {if(!this.disposed)this.problem("STORAGE");}};
  private notice=(event:Event)=>{if ((event as CustomEvent).detail===this.owner) void this.read();};
  private wake=()=>{void this.read();void this.drain();};
  async start() {
    window.addEventListener(NOTICE,this.notice);window.addEventListener("online",this.wake);window.addEventListener("focus",this.wake);
    if (typeof BroadcastChannel!=="undefined") {
      this.channel=new BroadcastChannel(NOTICE);this.channel.onmessage=e=>{if(e.data===this.owner)this.wake();};
    }
    // Also recovers a dead tab's lease, and works without BroadcastChannel/Web Locks.
    this.timer=setInterval(this.wake,5000);
    try {
      const state=await this.storage.change();this.emit(state);
      if (!state.items.length) await this.refresh();
      else void this.drain();
    } catch {if(!this.disposed)this.problem("STORAGE");}
  }
  dispose() {
    this.disposed=true;this.request?.abort();this.channel?.close();
    if(this.timer)clearInterval(this.timer);
    window.removeEventListener(NOTICE,this.notice);window.removeEventListener("online",this.wake);window.removeEventListener("focus",this.wake);
    if(!this.running)this.storage.close();
  }
  async enqueue(p:WorkoutOperation,revision:number) {
    const body=operationBody(p), bodyJson=JSON.stringify(body), id=operationId(p), at=new Date().toISOString();
    if("contextHash" in body) {
      const before=await this.storage.change(),view=projectOutbox(before);
      if(before.revision!==revision || !view.data?.session || view.error || await localContextHash(view.data.session)!==body.contextHash)throw new Error("LOCAL_CONFLICT");
    }
    const state=await this.storage.change(s=>{
      const duplicate=s.items.find(i=>i.id===id);
      if (duplicate) {if(duplicate.bodyJson!==bodyJson)throw new Error("LOCAL_CONFLICT");return false;}
      if(s.revision!==revision || s.items.some(i=>i.status==="conflict" || i.status==="auth") || s.items.length>=100) throw new Error("LOCAL_CONFLICT");
      const view=projectOutbox(s);
      if(!view.data || view.error || s.items.some(i=>i.action==="start"))throw new Error("LOCAL_CONFLICT");
      projectOperation(view.data,{action:p.action,body},at); // Reject stale UI/invalid local dependencies before disk/network.
      s.items.push({id,action:p.action,bodyJson,createdAt:at,status:"pending",attempts:0,nextAttempt:0});return true;
    });
    this.emit(state);this.notify();void this.drain();
  }
  private async fetchData():Promise<TodayData> {
    const response=await fetch("/api/workout-sessions",{cache:"no-store",headers:{"X-Workout-Owner":this.owner},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(response.status===401 || response.status===409?"AUTH":"LOAD_FAILED");
    const data=await response.json() as TodayData;
    if(!Array.isArray(data.days) || !data.previous || (data.session && data.session.userId!==this.owner))throw new Error("AUTH");
    return data;
  }
  async refresh() {
    try {
      const before=await this.storage.change();
      if(before.items.length) {this.emit(before);return;}
      const data=await this.fetchData();if(this.disposed)return;
      const state=await this.storage.change(s=>{
        if(s.items.length || s.revision!==before.revision)return false;
        s.confirmed=data;return true;
      });this.emit(state);this.notify();this.problem("");
    } catch(error) {if(!this.disposed)this.problem(error instanceof Error?error.message:"LOAD_FAILED");}
  }
  async remoteForConflict() {
    const state=await this.storage.change();
    if(state.items[0]?.status!=="conflict")throw new Error("LOCAL_CONFLICT");
    return {data:await this.fetchData(),revision:state.revision};
  }
  async discardConflict(remote:{data:TodayData;revision:number}) {
    const state=await this.storage.change(s=>{
      if(s.revision!==remote.revision || s.items[0]?.status!=="conflict" || s.lease)throw new Error("LOCAL_CONFLICT");
      s.discarded=[{at:new Date().toISOString(),items:s.items},...(s.discarded??[])].slice(0,5);
      s.items=[];s.confirmed=remote.data;return true;
    });this.emit(state);this.notify();this.problem("");
  }
  async retry() {
    const state=await this.storage.change(s=>{
      const head=s.items[0];
      if(!head || head.status==="conflict")return false;
      head.status="pending";head.nextAttempt=0;return true;
    });this.emit(state);this.notify();void this.drain(true);
  }
  async drain(force=false) {
    if(this.running || this.disposed || (!navigator.onLine && !force))return;
    this.running=true;
    try {
      while(!this.disposed && (navigator.onLine || force)) {
        const token=crypto.randomUUID(), now=Date.now();let claimed:OutboxItem | undefined;
        await this.storage.change(s=>{
          const head=s.items[0];
          if(!head || head.status==="conflict" || head.status==="auth" || head.nextAttempt>now || (s.lease && s.lease.until>now))return false;
          s.lease={itemId:head.id,token,until:now+40000};claimed=structuredClone(head);return true;
        },false);
        if(!claimed)break;
        const item=claimed;this.request=new AbortController();
        const timer=setTimeout(()=>this.request?.abort(),15000);
        let value:Session | {session:Session;receipts:TodayData["receipts"]} | undefined;
        let status:OutboxItem["status"]="retry", code="NETWORK";
        try {
          const endpoint=item.action==="replace" || item.action==="undoReplacement"?"/api/workout-replacements":
            item.action==="apply" || item.action==="undo"?"/api/workout-commands":"/api/workout-sessions";
          const response=await fetch(`${endpoint}?action=${item.action}`,{method:"POST",headers:{"Content-Type":"application/json","X-Workout-Owner":this.owner},
            body:item.bodyJson,signal:this.request.signal});
          const result=await response.json();
          if(response.ok) {
            const session=result.session??result;
            if(session.userId!==this.owner || !Array.isArray(session.sets))throw new Error("INVALID_RESPONSE");
            value=result;
          } else {code=typeof result.error==="string"?result.error:"HTTP_ERROR";status=retryDisposition(response.status,code);}
        } catch { /* Unknown outcome: retain the same bytes, never advance past this head. */ }
        finally {clearTimeout(timer);this.request=null;}
        const state=await this.storage.change(s=>{
          if(s.lease?.token!==token || s.items[0]?.id!==item.id)return false;
          delete s.lease;
          if(value && s.confirmed) {
            s.confirmed=mergeConfirmed(s.confirmed,item.action,value);s.items.shift();
          } else {
            const head=s.items[0];head.status=status;head.error=code;head.attempts++;
            head.nextAttempt=Date.now()+Math.min(60000,5000*2**Math.min(head.attempts,4));
          }
          return true;
        });
        this.emit(state);this.notify();
        if(!value)break;
        if(!state.items.length && !this.disposed)this.synced();
      }
    } catch {if(!this.disposed)this.problem("STORAGE");}
    finally {this.running=false;if(this.disposed)this.storage.close();}
  }
}
