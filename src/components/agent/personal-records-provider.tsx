"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { personalCommandSchema, type PersonalCommand, type PersonalRecord } from "@/lib/personal-records";
import {guestRecords,saveGuestCommand,GUEST_RECORD_EVENT} from "@/lib/guest-records";
import {collectGuestFacts} from "@/services/guest-fact-migration";
import {useTrackerStore} from "@/store/use-tracker-store";

type Pending = {key: string; body: string};
type Context = {owner: string | null; guest:boolean; canWrite:boolean; records: PersonalRecord[]; pending: Pending[]; loading: boolean; error: string;
  submit: (command: PersonalCommand) => Promise<boolean>; retry: () => void; discard: () => void};
const RecordsContext = createContext<Context | null>(null);
const prefix = (owner: string) => `liftcut-personal-v1:${owner}:`;
function readPending(owner: string): Pending[] {
  return Object.keys(localStorage).filter(key => key.startsWith(prefix(owner))).sort().map(key => {
    const body = localStorage.getItem(key)!; personalCommandSchema.parse(JSON.parse(body)); return {key,body};
  });
}

/** Immutable requests survive navigation/response loss; concurrent tabs safely replay the same UUID. */
export function PersonalRecordsProvider({owner,guest=false, children}: {owner: string | null; guest?:boolean; children: ReactNode}) {
  const [records,setRecords] = useState<PersonalRecord[]>([]), [pending,setPending] = useState<Pending[]>([]);
  const [loading,setLoading] = useState(!!owner), [error,setError] = useState("");
  const alive = useRef(true), flight = useRef(false), rejected = useRef<string | null>(null);
  const synchronize = useCallback(async () => {
    if(guest&&!owner){try{collectGuestFacts(useTrackerStore.getState().guestSnapshot);setRecords(guestRecords());setError("");}catch{setError("storage");}setLoading(false);return;}
    if (!owner || flight.current || !alive.current) return;
    flight.current = true;
    try {
      const queue = readPending(owner); setPending(queue);
      if (!navigator.onLine) {setLoading(false); return;}
      for (const item of queue) {
        if (!alive.current) return;
        const response = await fetch("/api/personal-records", {method:"POST",headers:{"Content-Type":"application/json","X-Workout-Owner":owner},body:item.body});
        if (!response.ok) {
          if ([400,404,409].includes(response.status)) rejected.current = item.key;
          throw new Error(response.status === 401 ? "auth" : rejected.current ? "conflict" : "retry");
        }
        if (!alive.current) return;
        // Remove only the exact immutable request acknowledged by the server.
        if (localStorage.getItem(item.key) === item.body) localStorage.removeItem(item.key);
        setPending(readPending(owner));
      }
      const response = await fetch("/api/personal-records",{headers:{"X-Workout-Owner":owner},cache:"no-store"});
      if (!response.ok) throw new Error(response.status === 401 ? "auth" : response.status === 404 ? "unavailable" : "load");
      const data: PersonalRecord[] = await response.json();
      if (alive.current) {setRecords(data); setError(""); rejected.current = null;}
    } catch (e) {
      if (alive.current) setError(e instanceof Error && ["auth","conflict","load","unavailable"].includes(e.message) ? e.message : "retry");
    } finally {flight.current=false; if (alive.current) setLoading(false);}
  },[owner,guest]);
  useEffect(() => {
    alive.current=true; void synchronize();
    const wake = () => void synchronize();
    window.addEventListener("online",wake); window.addEventListener("storage",wake); window.addEventListener("focus",wake);
    window.addEventListener(GUEST_RECORD_EVENT,wake);
    const interval = window.setInterval(wake,15000);
    return () => {alive.current=false; window.clearInterval(interval); window.removeEventListener("online",wake); window.removeEventListener("storage",wake); window.removeEventListener("focus",wake);window.removeEventListener(GUEST_RECORD_EVENT,wake);};
  },[synchronize]);
  async function submit(command: PersonalCommand) {
    if(guest&&!owner){try{saveGuestCommand(command);setRecords(guestRecords());setError("");return true;}catch{setError("storage");return false;}}
    if (!owner || rejected.current) {setError(owner ? "conflict" : "auth"); return false;}
    try {
      const req = personalCommandSchema.parse(command), body = JSON.stringify(req);
      // A deterministic key per UUID makes double-clicks and retries one operation.
      const key = prefix(owner)+req.id, old = localStorage.getItem(key);
      if (old !== null && old !== body) throw new Error("conflict");
      localStorage.setItem(key,body);
      if (localStorage.getItem(key) !== body) throw new Error("storage");
      setPending(readPending(owner)); setError(""); void synchronize(); return true;
    } catch {setError("storage"); return false;}
  }
  function discard() {
    if (!owner || !rejected.current) return;
    localStorage.removeItem(rejected.current); rejected.current=null; setPending(readPending(owner)); setError(""); void synchronize();
  }
  return <RecordsContext.Provider value={{owner,guest,canWrite:!!owner||guest,records,pending,loading,error,submit,retry:()=>void synchronize(),discard}}>{children}</RecordsContext.Provider>;
}
export function usePersonalRecords() {
  const value = useContext(RecordsContext); if (!value) throw new Error("PersonalRecordsProvider required"); return value;
}
