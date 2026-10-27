import { CoachHistoryClient as SharedHistoryClient } from "@liftcut/core/coach-history-client";
import { ownerLifecycle } from "./owner-lifecycle";
export type { HistoryState } from "@liftcut/core/coach-history-client";

/** Browser adapter; the state machine and prose-only persistence are shared with mobile. */
export class CoachHistoryClient extends SharedHistoryClient {
  private unregister=()=>{};
  private browserOwner:string|null;
  constructor(owner:string|null,en=false){
    let controller=new AbortController();
    super(owner,en,{
      storage:{getItem:key=>owner&&!ownerLifecycle.active(owner)?null:localStorage.getItem(key),setItem:(key,value)=>{
        if(owner)ownerLifecycle.assertActive(owner);localStorage.setItem(key,value);
      },removeItem:key=>localStorage.removeItem(key)},
      activate:()=>{if(owner)ownerLifecycle.assertActive(owner);controller=new AbortController();},dispose:()=>controller.abort(),
      online:()=>navigator.onLine,uuid:()=>crypto.randomUUID(),
      request:async(url,options={})=>ownerLifecycle.run(owner!,async()=>{
        const r=await fetch(`/api/coach/history${url}`,{...options,cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),
          headers:{"Content-Type":"application/json","X-Workout-Owner":owner!}});
        if(!r.ok)throw Error(r.status===404?"NOT_FOUND":r.status===401?"AUTH":r.status===409?"HISTORY_CONFLICT":"HISTORY_UNAVAILABLE");
        return r.json();
      }),
    });
    this.browserOwner=owner;
  }
  override async activate(){
    this.unregister();
    if(this.browserOwner)this.unregister=ownerLifecycle.register(this.browserOwner,()=>{this.dispose(false);return this.whenStored();});
    return super.activate();
  }
  override dispose(eraseCache=true){
    this.unregister();
    super.dispose(eraseCache&&(!this.browserOwner||ownerLifecycle.active(this.browserOwner)));
  }
}
