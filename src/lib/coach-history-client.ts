import { CoachHistoryClient as SharedHistoryClient } from "@liftcut/core/coach-history-client";
export type { HistoryState } from "@liftcut/core/coach-history-client";

/** Browser adapter; the state machine and prose-only persistence are shared with mobile. */
export class CoachHistoryClient extends SharedHistoryClient {
  constructor(owner:string|null,en=false){
    let controller=new AbortController();
    super(owner,en,{
      storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)},
      activate:()=>{controller=new AbortController();},dispose:()=>controller.abort(),
      online:()=>navigator.onLine,uuid:()=>crypto.randomUUID(),
      request:async(url,options={})=>{
        const r=await fetch(`/api/coach/history${url}`,{...options,cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),
          headers:{"Content-Type":"application/json","X-Workout-Owner":owner!}});
        if(!r.ok)throw Error(r.status===404?"NOT_FOUND":r.status===401?"AUTH":r.status===409?"HISTORY_CONFLICT":"HISTORY_UNAVAILABLE");
        return r.json();
      },
    });
  }
}
