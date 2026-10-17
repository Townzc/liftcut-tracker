import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {activeGuestFacts,saveGuestCommand,guestRecords,GUEST_RECORD_PREFIX} from "../src/lib/guest-records";
import {prepareGuestImport,migrateGuestFactsToUser} from "../src/services/guest-fact-migration";
import type {PersonalCommand} from "../src/lib/personal-records";
class StorageDouble{
  getItem(key:string){return Object.hasOwn(this,key)?String((this as unknown as Record<string,string>)[key]):null;}
  setItem(key:string,value:string){Object.defineProperty(this,key,{configurable:true,enumerable:true,writable:true,value});}
  removeItem(key:string){delete (this as unknown as Record<string,string>)[key];}
}
test("guest local confirmations are immutable, undo survives reload and failed import retains an exact retry journal",async t=>{
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:new StorageDouble()});
  Object.defineProperty(globalThis,"window",{configurable:true,value:new EventTarget()});
  const owner=randomUUID(),other=randomUUID(),command:PersonalCommand={action:"create",id:randomUUID(),entry:{kind:"body",date:"2026-08-16",weightKg:72.5,waistCm:null},source:"conversation",text:"记下体重 72.5 公斤",anchorDate:"2026-08-16"};
  try{
    saveGuestCommand(command);saveGuestCommand(command);assert.equal(activeGuestFacts().length,1);
    assert.throws(()=>saveGuestCommand({...command,text:"changed"}),/CONFLICT/);
    saveGuestCommand({action:"undo",id:randomUUID(),recordId:command.id});assert.equal(activeGuestFacts().length,0);assert.equal(guestRecords().length,1);
    const fresh={...command,id:randomUUID()};saveGuestCommand(fresh);
    const preview=prepareGuestImport({userId:owner,guestSnapshot:null});assert.equal(preview.records.length,1);
    assert.throws(()=>prepareGuestImport({userId:other,guestSnapshot:null}),/DESTINATION/);
    const requests:string[]=[];let attempt=0;
    t.mock.method(globalThis,"fetch",async(url:unknown,options?:RequestInit)=>{
      if(url==="/api/guest-session")return Response.json({remaining:10,limit:10});
      requests.push(String(options?.body));attempt++;
      if(attempt===1)throw new Error("response lost after commit");
      return Response.json({workspaceId:preview.workspaceId,count:1,recordIds:[fresh.id]});
    });
    await assert.rejects(migrateGuestFactsToUser({userId:owner,guestSnapshot:null}),/response lost/);
    assert.equal(activeGuestFacts().length,1);assert.ok(localStorage.getItem("liftcut-guest-import-v1"));
    // A newly confirmed fact in another tab is not deleted by an older import.
    const later={...fresh,id:randomUUID()};saveGuestCommand(later);
    await migrateGuestFactsToUser({userId:owner,guestSnapshot:null});assert.equal(requests[0],requests[1]);
    assert.equal(activeGuestFacts().length,1);assert.equal(activeGuestFacts()[0].id,later.id);
    assert.equal(localStorage.getItem(GUEST_RECORD_PREFIX+fresh.id),null);assert.equal(localStorage.getItem("liftcut-guest-import-v1"),null);
  }finally{Reflect.deleteProperty(globalThis,"window");if(previousStorage)Object.defineProperty(globalThis,"localStorage",previousStorage);else Reflect.deleteProperty(globalThis,"localStorage");}
});
