/** Per-request FIFO barrier: reads overlap, context/drafts/finalization are exclusive.
 * Rejections release the barrier. No tool retries and no changes to the SDK loop. */
export class CoachExecution {
  private barrier:Promise<unknown>=Promise.resolve();
  private readonly reads=new Set<Promise<unknown>>();
  private pending=0;
  get idle(){return this.pending===0;}
  run<T>(readOnly:boolean,work:()=>Promise<T>):Promise<T>{
    this.pending++;
    const ready=readOnly?this.barrier:Promise.allSettled([this.barrier,...this.reads]);
    const task=ready.then(work);
    if(readOnly)this.reads.add(task);
    else this.barrier=task.then(()=>{},()=>{});
    void task.finally(()=>{this.pending--;this.reads.delete(task);}).catch(()=>{});
    return task;
  }
}
