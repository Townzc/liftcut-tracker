export type CoachSpan = {name:string;startMs:number;durationMs:number};
export type CoachModelTiming = CoachSpan & {firstOutputMs:number|null;httpHeadersMs:number|null;inputTokens:number|null;cacheReadTokens:number|null;outputTokens:number|null};
export type CoachTiming = {
  version:1;serverMs:number;firstTextMs:number|null;authMs:number|null;quotaMs:number|null;
  model:CoachModelTiming[];tools:CoachSpan[];database:CoachSpan[];toolWallMs:number;
};

/** Union, not sum: simultaneous reads must not inflate the wall-clock cost. */
export function spanWallMs(spans:CoachSpan[]):number {
  let total=0,end=0;
  for(const s of [...spans].sort((a,b)=>a.startMs-b.startMs)){
    const next=s.startMs+s.durationMs;total+=Math.max(0,next-Math.max(end,s.startMs));end=Math.max(end,next);
  }
  return Math.round(total);
}

/** Request-local, numeric metadata only. Never accepts prompts, SQL or tool data. */
export class CoachTimer {
  private readonly began:number;
  private readonly spans:CoachTiming={version:1,serverMs:0,firstTextMs:null,authMs:null,quotaMs:null,model:[],tools:[],database:[],toolWallMs:0};
  constructor(private readonly clock=()=>performance.now()){this.began=clock();}
  elapsed(){return Math.max(0,Math.round(this.clock()-this.began));}
  firstText(){this.spans.firstTextMs??=this.elapsed();}
  async measure<T>(name:"auth"|"quota",work:()=>Promise<T>):Promise<T>{
    const start=this.elapsed();try{return await work();}finally{this.spans[name==="auth"?"authMs":"quotaMs"]=this.elapsed()-start;}
  }
  async db<T>(name:string,work:()=>Promise<T>):Promise<T>{
    const startMs=this.elapsed();try{return await work();}finally{if(this.spans.database.length<100)this.spans.database.push({name,startMs,durationMs:this.elapsed()-startMs});}
  }
  tool(name:string,startMs:number){if(this.spans.tools.length<30)this.spans.tools.push({name,startMs,durationMs:this.elapsed()-startMs});}
  model(value:CoachModelTiming){if(this.spans.model.length<6)this.spans.model.push(value);}
  snapshot():CoachTiming{return {...this.spans,serverMs:this.elapsed(),model:[...this.spans.model],tools:[...this.spans.tools],database:[...this.spans.database],toolWallMs:spanWallMs(this.spans.tools)};}
}
