import type { StateCreator } from "zustand";
import type { TrackerState } from "./use-tracker-store";
import { ownerLifecycle } from "@/lib/owner-lifecycle";

type AsyncKeys<T> = { [K in keyof T]: T[K] extends (...args: never[])=>Promise<unknown> ? K : never }[keyof T];
/** Each invocation captures its owner, including late optimistic rollback writes.
 * Factories are pure: rebuilding the slice binds only its setter, not a new store.
 */
export function ownerSlice<T>(factory: StateCreator<TrackerState,[],[],T>,
  args: Parameters<StateCreator<TrackerState,[],[],T>>, keys: AsyncKeys<T>[]):T {
  const [set,get,store]=args,result=factory(...args);
  for(const key of keys){
    const original=result[key] as (...args:unknown[])=>Promise<unknown>;
    result[key]=((...parameters:unknown[])=>{
      const state=get(),owner=state.authMode==="authenticated"?state.userId:null;
      if(!owner)return original(...parameters);
      const current=()=>get().userId===owner&&get().authMode==="authenticated"&&ownerLifecycle.active(owner);
      const scopedSet:typeof set=(patch,replace)=>{
        if(!current())return;
        if(replace)set(patch as TrackerState,true);else set(patch,false);
      };
      return ownerLifecycle.run(owner,()=>{
        if(!current())throw Error("ACCOUNT_CHANGED");
        const action=factory(scopedSet,get,store)[key] as (...args:unknown[])=>Promise<unknown>;
        return action(...parameters);
      });
    }) as T[typeof key];
  }
  return result;
}
