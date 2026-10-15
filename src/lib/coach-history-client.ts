import { z } from "zod";
import { historyItemSchema,savedCoachTurn,restoredCoachTurn,mergeHistory,type CoachTurn,type HistoryItem,type HistoryCursor,type ConversationList,type ConversationPage,type ConversationSummary } from "./coach-history";

type LocalChat={id:string;text:string;items:HistoryItem[];live:CoachTurn[];dirty:Set<string>;signatures:Map<string,string>;older:HistoryCursor|null};
export type HistoryState={id:string;text:string;turns:CoachTurn[];threads:ConversationSummary[];next:HistoryCursor|null;older:HistoryCursor|null;ready:boolean;loading:boolean;sync:"idle"|"saving"|"saved"|"offline"|"error";error:string|null};
const empty:HistoryState={id:"",text:"",turns:[],threads:[],next:null,older:null,ready:false,loading:false,sync:"idle",error:null};
const cacheSchema=z.object({version:z.literal(1),active:z.uuid(),chats:z.array(z.object({id:z.uuid(),text:z.string().max(400),items:z.array(historyItemSchema),dirty:z.array(z.uuid())}))});
const key=(owner:string)=>`liftcut-chat-history:${owner}`;

/** Account-scoped prose cache + durable upload queue. Never stores actionable proposals. */
export class CoachHistoryClient {
  private state:HistoryState=empty;
  private chats=new Map<string,LocalChat>();
  private listeners=new Set<()=>void>();
  private alive=true;
  private activated=false;
  private flushing=false;
  private controller=new AbortController();
  private selection=0;
  constructor(private owner:string|null,private en=false){}
  subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
  snapshot=()=>this.state;
  serverSnapshot=()=>empty;
  private publish(patch:Partial<HistoryState>={}){
    if(!this.alive)return;const chat=this.chats.get(patch.id??this.state.id);
    this.state={...this.state,...patch,...(chat?{id:chat.id,text:chat.text,turns:chat.live,older:chat.older}:{})};
    for(const f of this.listeners)f();
  }
  private chat(id=crypto.randomUUID()):LocalChat{return {id,text:"",items:[],live:[],dirty:new Set(),signatures:new Map(),older:null};}
  private cache(){
    if(!this.owner)return;
    try{
      const chats=[...this.chats.values()].filter(c=>c.id===this.state.id||c.dirty.size).map(c=>({id:c.id,text:c.text,
        items:c.items.filter((i,n)=>n>=c.items.length-100||c.dirty.has(i.turn.id)),dirty:[...c.dirty]}));
      localStorage.setItem(key(this.owner),JSON.stringify({version:1,active:this.state.id,chats}));
    }catch{this.publish({sync:"error",error:"LOCAL_STORAGE"});}
  }
  private async request(url:string,options:RequestInit={}){
    if(!this.owner||!this.alive)throw Error("UNAUTHORIZED");
    const r=await fetch(`/api/coach/history${url}`,{...options,cache:"no-store",signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]),
      headers:{"Content-Type":"application/json","X-Workout-Owner":this.owner,...options.headers}});
    if(!r.ok)throw Error(r.status===404?"NOT_FOUND":r.status===401?"AUTH":r.status===409?"HISTORY_CONFLICT":"HISTORY_UNAVAILABLE");
    return r.json();
  }
  activate(){
    if(this.activated&&this.alive)return;this.alive=true;this.activated=true;this.controller=new AbortController();
    if(this.owner)try{
      const raw=localStorage.getItem(key(this.owner));if(raw){const cached=cacheSchema.parse(JSON.parse(raw));
        for(const c of cached.chats){const chat=this.chat(c.id);chat.text=c.text;chat.items=c.items;chat.dirty=new Set(c.dirty);
          chat.live=c.items.map(i=>restoredCoachTurn(i.turn,this.en));chat.signatures=new Map(chat.live.map(t=>[t.id,JSON.stringify(savedCoachTurn(t))]));this.chats.set(c.id,chat);}
        if(this.chats.has(cached.active))this.state={...this.state,id:cached.active};
      }
    }catch{this.publish({error:"LOCAL_STORAGE"});}
    if(!this.chats.has(this.state.id)){const c=this.chat();this.chats.set(c.id,c);this.state={...this.state,id:c.id};}
    this.publish({ready:true});
    // History and cloud synchronization never gate the composer or model request.
    if(this.owner){void this.refreshList();const c=this.chats.get(this.state.id)!;
      if(c.items.length&&!c.dirty.size)void this.refreshCurrent();void this.flush();}
  }
  dispose(){this.alive=false;this.controller.abort();if(this.owner)try{localStorage.removeItem(key(this.owner));}catch{/* account boundary still clears memory */}}
  setText=(text:string)=>{const c=this.chats.get(this.state.id);if(!c)return;c.text=text;this.publish();this.cache();};
  setTurns=(next:CoachTurn[]|((xs:CoachTurn[])=>CoachTurn[]))=>{
    const c=this.chats.get(this.state.id);if(!c||!this.alive)return;const previous=new Map(c.live.map(t=>[t.id,t]));c.live=typeof next==="function"?next(c.live):next;let changed=false;
    for(const turn of c.live){if(previous.get(turn.id)===turn)continue;const saved=savedCoachTurn(turn),signature=JSON.stringify(saved);if(c.signatures.get(turn.id)===signature)continue;
      c.signatures.set(turn.id,signature);const old=c.items.find(i=>i.turn.id===turn.id),item={turn:saved,revision:(old?.revision??0)+1};
      c.items=mergeHistory(c.items.filter(i=>i.turn.id!==turn.id),[item]);c.dirty.add(turn.id);changed=true;
    }
    this.publish();if(changed){this.cache();void this.flush();}
  };
  async flush(){
    if(this.flushing||!this.owner||!this.alive)return;
    if(!navigator.onLine){this.publish({sync:"offline"});return;}
    this.flushing=true;
    try{
      for(const c of this.chats.values())while(c.dirty.size&&this.alive){
        const items=c.items.filter(i=>c.dirty.has(i.turn.id)).slice(0,10);if(!items.length)break;
        this.publish({sync:"saving",error:null});await this.request("",{method:"POST",body:JSON.stringify({conversationId:c.id,items})});
        if(!this.alive)return;
        for(const sent of items)if(c.items.find(i=>i.turn.id===sent.turn.id)?.revision===sent.revision)c.dirty.delete(sent.turn.id);
        const first=c.items[0];if(first){const summary={id:c.id,title:first.turn.text.slice(0,80),updatedAt:new Date().toISOString()};
          this.state={...this.state,threads:[summary,...this.state.threads.filter(t=>t.id!==c.id)]};}
        this.cache();
      }
      this.publish({sync:"saved",error:null});
    }catch(e){if(this.alive)this.publish({sync:navigator.onLine?"error":"offline",error:e instanceof Error?e.message:"HISTORY_UNAVAILABLE"});}
    finally{this.flushing=false;}
  }
  newConversation(){const c=this.chat();this.selection++;this.chats.set(c.id,c);this.publish({id:c.id,error:null,loading:false});this.cache();}
  async refreshList(more=false){
    if(!this.owner)return;
    try{const page:ConversationList=await this.request(more&&this.state.next?`?before=${encodeURIComponent(JSON.stringify(this.state.next))}`:"");
      this.publish({threads:more?[...this.state.threads,...page.items.filter(t=>!this.state.threads.some(x=>x.id===t.id))]:page.items,next:page.next});
    }catch(e){if(this.alive)this.publish({error:e instanceof Error?e.message:"HISTORY_UNAVAILABLE"});}
  }
  async select(id:string){
    const ticket=++this.selection;this.publish({loading:true,error:null});
    try{const page:ConversationPage=await this.request(`?id=${encodeURIComponent(id)}`);if(!this.alive||ticket!==this.selection)return;
      const c=this.chats.get(id)??this.chat(id);this.mergePage(c,page);this.chats.set(id,c);this.publish({id,loading:false});this.cache();
    }catch(e){if(ticket===this.selection)this.publish({loading:false,error:e instanceof Error?e.message:"HISTORY_UNAVAILABLE"});}
  }
  private mergePage(c:LocalChat,page:ConversationPage){
    c.items=mergeHistory(c.items,page.items);c.older=page.next;
    const live=new Map(c.live.map(t=>[t.id,t]));
    c.live=c.items.map(i=>c.dirty.has(i.turn.id)&&live.has(i.turn.id)?live.get(i.turn.id)!:restoredCoachTurn(i.turn,this.en));
    c.signatures=new Map(c.live.map(t=>[t.id,JSON.stringify(savedCoachTurn(t))]));
  }
  private async refreshCurrent(){
    const id=this.state.id,ticket=this.selection,c=this.chats.get(id)!;
    try{const page:ConversationPage=await this.request(`?id=${encodeURIComponent(id)}`);
      if(this.alive&&this.state.id===id&&ticket===this.selection&&!c.dirty.size&&!c.live.some(t=>t.pending)){this.mergePage(c,page);this.publish();this.cache();}
    }catch(e){
      // A confirmed deletion on another device invalidates this cached copy.
      // Transport failures keep it visible; unsent messages remain retryable.
      if(e instanceof Error&&e.message==="NOT_FOUND"&&this.alive&&this.state.id===id&&ticket===this.selection&&!c.dirty.size){
        this.chats.delete(id);this.publish({threads:this.state.threads.filter(t=>t.id!==id)});this.newConversation();
      }
    }
  }
  async older(){
    const c=this.chats.get(this.state.id);if(!c?.older)return;const id=c.id,ticket=this.selection;
    this.publish({loading:true});try{const page:ConversationPage=await this.request(`?id=${encodeURIComponent(id)}&before=${encodeURIComponent(JSON.stringify(c.older))}`);
      if(this.alive&&ticket===this.selection){this.mergePage(c,page);this.publish({loading:false});this.cache();}
    }catch{this.publish({loading:false,error:"HISTORY_UNAVAILABLE"});}
  }
  async remove(id:string){
    this.publish({loading:true,error:null});
    try{await this.request("",{method:"DELETE",body:JSON.stringify({id})});if(!this.alive)return;
      this.chats.delete(id);this.publish({threads:this.state.threads.filter(c=>c.id!==id),loading:false});
      if(this.state.id===id)this.newConversation();this.cache();
    }catch(e){this.publish({loading:false,error:e instanceof Error?e.message:"HISTORY_UNAVAILABLE"});}
  }
}
