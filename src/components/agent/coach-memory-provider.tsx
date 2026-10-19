"use client";
import { createContext,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode } from "react";
import { useLocale } from "next-intl";
import { CoachHistoryClient } from "@/lib/coach-history-client";
import type { Session } from "@/lib/today";
import type { LogDraft } from "@liftcut/core/workout-log-parser";
import type { WorkoutOperation } from "@/lib/workout-outbox";
import type { PersonalCommand } from "@/lib/personal-records";
import type { RunView } from "@liftcut/core/agent-contracts";
export type CoachWorkoutProposal={turnId:string;session:Session;hash:string;draft:LogDraft;operation:WorkoutOperation};
function useMemory(owner:string|null){
  const en=useLocale()==="en",[history]=useState(()=>new CoachHistoryClient(owner,en));
  const snapshot=useSyncExternalStore(history.subscribe,history.snapshot,history.serverSnapshot);
  const [selected,setSelected]=useState(""),[proposal,setProposal]=useState<CoachWorkoutProposal|null>(null);
  const [working,setWorking]=useState(false),flight=useRef(false),modelRequest=useRef<AbortController|null>(null);
  const [planRun,setPlanRun]=useState<RunView|null>(null),[planRunId,setPlanRunId]=useState<string|undefined>(),[planWorking,setPlanWorking]=useState(false);
  const [streamStage,setStreamStage]=useState<"connecting"|"reading"|"drafting"|"answering">("connecting");
  const [personalProposal,setPersonalProposal]=useState<{turnId:string;command:Extract<PersonalCommand,{action:"create"}>}|null>(null);
  const [resolveText,setResolveText]=useState<string|null>(null),[replace,setReplace]=useState<{session:string;exerciseId?:string}|null>(null);
  useEffect(()=>{
    const online=()=>{void history.flush();};window.addEventListener("online",online);
    // Abort the latest request on the account boundary, not the controller at mount.
    const stop=()=>modelRequest.current?.abort();
    return()=>{window.removeEventListener("online",online);stop();history.dispose();};
  },[history]);
  return {history,snapshot,text:snapshot.text,setText:history.setText,turns:snapshot.turns,setTurns:history.setTurns,selected,setSelected,proposal,setProposal,working,setWorking,flight,modelRequest,planRun,setPlanRun,planRunId,setPlanRunId,planWorking,setPlanWorking,streamStage,setStreamStage,personalProposal,setPersonalProposal,resolveText,setResolveText,replace,setReplace};
}
const Context=createContext<ReturnType<typeof useMemory>|null>(null);
export function CoachMemoryProvider({owner,children}:{owner:string|null;children:ReactNode}){return <Context.Provider value={useMemory(owner)}>{children}</Context.Provider>;}
export function useCoachMemory(){const value=useContext(Context);if(!value)throw Error("CoachMemoryProvider required");return value;}
