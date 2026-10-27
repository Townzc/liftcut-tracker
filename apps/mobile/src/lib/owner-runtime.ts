/** A pending deletion blocks this owner's ordinary work until the app restarts.
 * Every mounted writer registers its stop/drain; detached asynchronous writes stay tracked.
 */
type Worker = { stop(): void; idle(): Promise<unknown> };
export class OwnerRuntime {
  private blocked = new Set<string>();
  private workers = new Map<string, Map<Worker, number>>();
  private tasks = new Map<string, Set<Promise<unknown>>>();
  private aborts = new Map<string, Set<AbortController>>();
  isBlocked(owner?: string) { return !!owner && this.blocked.has(owner); }
  assert(owner: string) { if (this.isBlocked(owner)) throw Error("ACCOUNT_DELETING"); }
  register(owner: string, worker: Worker) {
    this.assert(owner);
    const set = this.workers.get(owner) ?? new Map(); this.workers.set(owner, set); set.set(worker, (set.get(worker) ?? 0) + 1);
    return () => {
      set.set(worker, (set.get(worker) ?? 1) - 1);
      // React effect replay may immediately register the same worker again.
      queueMicrotask(() => { if (set.get(worker) === 0) { worker.stop(); this.track(owner, worker.idle()); set.delete(worker); } });
    };
  }
  block(owner: string) {
    this.blocked.add(owner);
    for (const worker of this.workers.get(owner)?.keys() ?? []) worker.stop();
    for (const abort of this.aborts.get(owner) ?? []) abort.abort();
  }
  private track<T>(owner: string, promise: Promise<T>) {
    const set = this.tasks.get(owner) ?? new Set(); this.tasks.set(owner, set); set.add(promise);
    void promise.finally(() => set.delete(promise)).catch(() => {}); return promise;
  }
  run<T>(owner: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assert(owner);
    const abort = new AbortController(), set = this.aborts.get(owner) ?? new Set();
    this.aborts.set(owner, set); set.add(abort);
    return this.track(owner, (async () => {
      try { const result = await work(abort.signal); this.assert(owner); return result; }
      finally { set.delete(abort); }
    })());
  }
  async idle(owner: string) {
    this.block(owner);
    await Promise.allSettled([...(this.tasks.get(owner) ?? []), ...[...(this.workers.get(owner)?.keys() ?? [])].map(w => w.idle())]);
  }
}
export const ownerRuntime = new OwnerRuntime();
