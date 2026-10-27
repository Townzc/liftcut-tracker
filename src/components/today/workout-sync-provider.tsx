"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import type {OutboxState} from "@liftcut/core/workout-outbox";
import {WorkoutOutboxClient} from "@/services/today/outbox-client";
import {useTrackerStore} from "@/store/use-tracker-store";
import {ownerLifecycle} from "@/lib/owner-lifecycle";

function useSync(owner:string|null){
  const client=useRef<WorkoutOutboxClient|null>(null);
  const [state,setState]=useState<OutboxState|null>(null),[error,setError]=useState("");
  const activate=useCallback(()=>{
    if(!owner || !ownerLifecycle.active(owner))return;
    if(client.current){void client.current.refresh();return;}
    const outbox=new WorkoutOutboxClient(owner,next=>setState(old=>old&&old.revision>=next.revision?old:next),setError,()=>{
      const store=useTrackerStore.getState();
      if(store.authMode==="authenticated"&&store.userId===owner)void store.refreshUserData().catch(()=>{});
    });
    client.current=outbox;void outbox.start();
  },[owner]);
  // Lazy start when recording/Agent is first opened, then retain the queue across
  // tabs. Only the keyed account boundary tears down/aborts this owner's worker.
  useEffect(()=>()=>{client.current?.dispose();client.current=null;},[]);
  return {owner,client,state,error,setError,activate};
}
const Context=createContext<ReturnType<typeof useSync>|null>(null);
export function WorkoutSyncProvider({owner,children}:{owner:string|null;children:ReactNode}){
  return <Context.Provider value={useSync(owner)}>{children}</Context.Provider>;
}
export function useWorkoutSync(){const value=useContext(Context);if(!value)throw Error("WorkoutSyncProvider required");return value;}
