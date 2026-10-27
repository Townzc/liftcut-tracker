import { z } from "zod";

const marker = (owner: string) => `liftcut-account-lifecycle:${owner}`;
export const OWNER_LIFECYCLE_EVENT="liftcut-account-lifecycle-change";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
/** Browser-only owner boundary. Markers are not an approval ledger or a server deletion receipt. */
export class OwnerLifecycle {
  private work = new Map<string, Set<Promise<unknown>>>();
  private stops = new Map<string, Set<() => void | Promise<void>>>();
  constructor(private storage: () => Storage, private notify: (owner:string)=>void=()=>{},private removeDraft:(owner:string)=>void=()=>{}) {}
  status(owner: string):"active"|"pending"|"deleted"|"unavailable" {
    try { const storage=this.storage(),value=storage.getItem(marker(owner));
      return value==="deleted"?"deleted":value!==null||storage.getItem(`liftcut-deletion-v1:${owner}`)!==null?"pending":"active"; }
    catch { return "unavailable"; }
  }
  active(owner: string) { return this.status(owner)==="active"; }
  assertActive(owner: string) { if (!this.active(owner)) throw Error("ACCOUNT_STOPPED"); }
  register(owner: string, stop: () => void | Promise<void>) {
    const stops = this.stops.get(owner) ?? new Set(); this.stops.set(owner, stops); stops.add(stop);
    if (!this.active(owner)) void Promise.resolve(stop()).catch(() => {});
    return () => { stops.delete(stop); if (!stops.size) this.stops.delete(owner); };
  }
  async run<T>(owner: string, work: () => Promise<T>): Promise<T> {
    this.assertActive(owner);
    const tasks = this.work.get(owner) ?? new Set(); this.work.set(owner, tasks);
    const task = Promise.resolve().then(() => { this.assertActive(owner); return work(); }); tasks.add(task);
    try { return await task; } finally { tasks.delete(task); if (!tasks.size) this.work.delete(owner); }
  }
  async settled(owner: string) {
    while (this.work.get(owner)?.size) await Promise.allSettled([...this.work.get(owner)!]);
  }
  /** Call once the server accepted pending deletion. Retain every queued byte. */
  async stop(owner: string) {
    z.uuid().parse(owner);
    if (this.storage().getItem(marker(owner)) !== "deleted") this.storage().setItem(marker(owner), "pending");
    this.notify(owner);
    await Promise.all([...(this.stops.get(owner) ?? [])].map(stop => stop()));
    await this.settled(owner);
  }
  /** Caller must first verify this owner's server result. Logout/transport errors never purge. */
  async purge(result: { status: "deleted"; owner: string }, removeOutbox: (owner: string) => Promise<void>) {
    const { owner } = z.object({ status: z.literal("deleted"), owner: z.uuid() }).strict().parse(result);
    await this.stop(owner);
    // Keep the tombstone even if cleanup fails, allowing a safe cleanup retry.
    const storage = this.storage(); storage.setItem(marker(owner), "deleted");
    this.notify(owner);
    await removeOutbox(owner);
    this.removeDraft(owner);
    const exact = new Set([`liftcut-chat-history:${owner}`, `liftcut-review:${owner}`, `liftcut-coach-consent:${owner}`,
      `liftcut-p1-${owner}`, `liftcut-p1-${owner}-pending`]);
    const keys = Array.from({ length: storage.length }, (_, n) => storage.key(n));
    for (const key of keys) if (key && (exact.has(key) || key.startsWith(`liftcut-personal-v1:${owner}:`))) storage.removeItem(key);
  }
  /** Other tabs stop independently; transaction-level checks also block late commits. */
  changed(key: string | null) {
    const owner=key?.startsWith("liftcut-account-lifecycle:")?key.slice("liftcut-account-lifecycle:".length):null;
    if(owner&&this.status(owner)==="deleted")this.removeDraft(owner);
    for (const [owner, stops] of this.stops) if ((key === null || key === marker(owner) || key===`liftcut-deletion-v1:${owner}`) && !this.active(owner)) {
      this.notify(owner);
      for (const stop of stops) void Promise.resolve(stop()).catch(() => {});
    }
  }
}
export const ownerLifecycle = new OwnerLifecycle(() => localStorage,owner=>{
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(OWNER_LIFECYCLE_EVENT,{detail:{owner}}));
},owner=>{if(typeof sessionStorage!=="undefined")sessionStorage.removeItem(`liftcut-p1-draft:${owner}`);});
if (typeof window !== "undefined") window.addEventListener("storage", event => ownerLifecycle.changed(event.key));
