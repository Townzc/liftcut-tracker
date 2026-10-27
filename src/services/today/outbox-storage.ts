import { emptyOutbox, operationBody, operationId, operationOf, type OutboxState } from "@liftcut/core/workout-outbox";
import { ownerLifecycle } from "@/lib/owner-lifecycle";

export const OUTBOX_DB = "liftcut-workout-outbox-v1";
// An account record and its queue/lease are committed in one IDB transaction.
// Never await network/crypto inside an IndexedDB transaction.
export class OutboxStorage {
  private database:Promise<IDBDatabase>;
  constructor(private owner:string) {
    this.database=new Promise((resolve,reject)=>{
      const request=indexedDB.open(OUTBOX_DB,1);
      let expired=false;
      const timer=setTimeout(()=>{expired=true;reject(new Error("STORAGE_UNAVAILABLE"));},4000);
      request.onupgradeneeded=()=>request.result.createObjectStore("accounts",{keyPath:"owner"});
      request.onerror=()=>{clearTimeout(timer);reject(request.error);};
      request.onblocked=()=>{clearTimeout(timer);expired=true;reject(new Error("STORAGE_UNAVAILABLE"));};
      request.onsuccess=()=>{
        clearTimeout(timer);
        if (expired) {request.result.close();return;}
        request.result.onversionchange=()=>request.result.close();resolve(request.result);
      };
    });
  }
  change(update?:(s:OutboxState)=>boolean, bump=true):Promise<OutboxState> {
    return ownerLifecycle.run(this.owner,()=>this.transaction(update,bump));
  }
  private async transaction(update?:(s:OutboxState)=>boolean, bump=true):Promise<OutboxState> {
    const db=await this.database;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("accounts",update?"readwrite":"readonly");
      const store=tx.objectStore("accounts"), get=store.get(this.owner);
      let result:OutboxState, failure:unknown;
      get.onsuccess=()=>{
        try {
          ownerLifecycle.assertActive(this.owner);
          result=get.result??emptyOutbox(this.owner);
          if (result.version!==1 || result.owner!==this.owner || !Array.isArray(result.items)) throw new Error("STORAGE_VERSION");
          for(const item of result.items) {
            if(!["start","set","end","apply","undo","replace","undoReplacement","review"].includes(item.action) || !["pending","retry","auth","conflict"].includes(item.status))throw new Error("STORAGE_VERSION");
            const p=operationOf(item);
            if(operationId(p)!==item.id || JSON.stringify(operationBody(p))!==item.bodyJson)throw new Error("STORAGE_VERSION");
          }
          if (update?.(result)) {if (bump) result.revision++;store.put(result);}
        } catch (error) {failure=error;tx.abort();}
      };
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure??tx.error??new Error("STORAGE_UNAVAILABLE"));
      tx.onerror=()=>{failure??=tx.error;};
    });
  }
  async removeDeletedOwner() {
    if (localStorage.getItem(`liftcut-account-lifecycle:${this.owner}`)!=="deleted") throw Error("DELETION_UNCONFIRMED");
    const db=await this.database;
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction("accounts","readwrite");tx.objectStore("accounts").delete(this.owner);
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error("STORAGE_UNAVAILABLE"));
    });
  }
  close() {void this.database.then(db=>db.close()).catch(()=>{});}
}

export async function removeDeletedOutbox(owner:string) {
  const storage=new OutboxStorage(owner);
  try {await storage.removeDeletedOwner();} finally {storage.close();}
}
