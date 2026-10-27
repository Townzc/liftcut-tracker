import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createStore,type StateCreator} from "zustand/vanilla";
import type {TrackerState} from "../src/store/use-tracker-store";
import {ownerSlice} from "../src/store/owner-slice";
import {ownerLifecycle,OwnerLifecycle} from "../src/lib/owner-lifecycle";

function storage(){const values=new Map<string,string>();return {values,getItem:(k:string)=>values.get(k)??null,
  setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},key:(n:number)=>[...values.keys()][n]??null,get length(){return values.size;}};}
function wait(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

test("full legacy action settles before cleanup; late failure cannot overwrite B or stopped A",async()=>{
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:storage()});
  const a=randomUUID(),b=randomUUID(),gate=wait();let called=0,finished=false;
  const factory:StateCreator<TrackerState,[],[],Pick<TrackerState,"addFoodLog">>=(set)=>({addFoodLog:async()=>{
    called++;set({selectedDay:2});try{await gate.promise;throw Error("transport failed");}catch(error){set({selectedDay:1});throw error;}
  }});
  const store=createStore<TrackerState>()((set,get,api)=>({...({userId:a,authMode:"authenticated",selectedDay:1} as TrackerState),
    ...ownerSlice(factory,[set,get,api],["addFoodLog"])}));
  const entry={date:"2026-10-27",mealType:"snack" as const,foodName:"synthetic",calories:100,protein:3};
  const request=store.getState().addFoodLog(entry);const failure=assert.rejects(request,/transport failed/);
  await Promise.resolve();assert.equal(store.getState().selectedDay,2);
  const stopping=ownerLifecycle.stop(a).then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);
  await assert.rejects(store.getState().addFoodLog(entry),/ACCOUNT_STOPPED/);assert.equal(called,1);
  store.setState({userId:b,selectedDay:7});gate.release();await failure;await stopping;
  assert.equal(store.getState().userId,b);assert.equal(store.getState().selectedDay,7);
});

test("guest actions keep their existing local path without an account lifecycle marker",async()=>{
  const data=storage();Object.defineProperty(globalThis,"localStorage",{configurable:true,value:data});
  const factory:StateCreator<TrackerState,[],[],Pick<TrackerState,"resetAllData">>=(set)=>({resetAllData:async()=>{set({selectedDay:4});}});
  const store=createStore<TrackerState>()((set,get,api)=>({...({userId:"guest",authMode:"guest",selectedDay:1} as TrackerState),
    ...ownerSlice(factory,[set,get,api],["resetAllData"])}));
  await store.getState().resetAllData();assert.equal(store.getState().selectedDay,4);assert.equal(data.values.size,0);
});

test("saved deletion intent blocks cold start before marker; owner draft purge preserves B and legacy",async()=>{
  const local=storage(),session=storage(),a=randomUUID(),b=randomUUID();let stopped=false;
  const life=new OwnerLifecycle(()=>local,()=>{},owner=>session.removeItem(`liftcut-p1-draft:${owner}`));
  local.setItem(`liftcut-deletion-v1:${a}`,"pending receipt intent");
  life.register(a,()=>{stopped=true;});assert.equal(stopped,true);assert.equal(life.status(a),"pending");assert.equal(life.active(b),true);
  for(const key of [`liftcut-p1-draft:${a}`,`liftcut-p1-draft:${b}`,"liftcut-p1-draft"])session.setItem(key,"draft");
  await life.purge({status:"deleted",owner:a},async()=>{});
  assert.equal(session.getItem(`liftcut-p1-draft:${a}`),null);assert.equal(session.getItem(`liftcut-p1-draft:${b}`),"draft");
  assert.equal(session.getItem("liftcut-p1-draft"),"draft");assert.equal(local.getItem(`liftcut-deletion-v1:${a}`),"pending receipt intent");
});
