import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {CoachHistoryClient} from "../src/lib/coach-history-client";
import {savedCoachTurn,restoredCoachTurn,type CoachTurn,type HistoryItem} from "../src/lib/coach-history";
import {conversationHistory} from "../src/lib/coach-model";
import {simpleCoachChat} from "../src/lib/coach-smalltalk";

const turn=(text="你好"):CoachTurn=>({id:randomUUID(),at:new Date().toISOString(),text,reply:"data",lines:["完整回答"]});
const settle=()=>new Promise(r=>setTimeout(r,20));
function browser(){
  const entries=new Map<string,string>();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)}});
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:true}});
  return entries;
}
test("history contains no executable proof, copied sources or provisional output; interrupted text is not memory",()=>{
  const t={...turn(),pending:true,sources:[{id:"secret source"}]} as CoachTurn;
  const saved=savedCoachTurn(t);assert.equal(saved.lines,undefined);assert.equal("sources" in saved,false);
  const restored=restoredCoachTurn(saved);assert.equal(restored.interrupted,true);assert.deepEqual(conversationHistory([restored]),[]);
  assert.equal(conversationHistory(Array.from({length:10},(_,i)=>turn(String(i)))).length,12);
});
test("small chat shortcut only accepts complete isolated greetings and capability questions",()=>{
  for(const text of ["你好！"," Hello. ","你能做什么？"])assert.equal(simpleCoachChat(text,[]),true);
  for(const text of ["你好，看看我的体重","谢谢，保存吧","那昨天呢","我该怎么练","介绍一下我上周训练"])assert.equal(simpleCoachChat(text,[]),false);
  assert.equal(simpleCoachChat("你好",[{role:"user",content:"我想补录"}]),false);
});
test("long rule-mode progress remains usable and only oversized stored copies are explicitly shortened",()=>{
  const lines=Array.from({length:20},(_,i)=>`深蹲 · 第 ${i+1} 组: 50 kg × 8 · RPE —`),full={...turn(),lines};
  assert.deepEqual(savedCoachTurn(full).lines,lines);
  const large={...turn(),lines:Array.from({length:600},()=>"深蹲训练实际记录 ".repeat(100))},saved=savedCoachTurn(large);
  assert.ok(new TextEncoder().encode(JSON.stringify(saved)).length<20000);assert.match(saved.lines!.at(-1)!,/历史内容已缩略/);
  assert.equal(large.lines.length,600);
  const escaped=savedCoachTurn({...turn("\u0000".repeat(400)),lines:Array.from({length:600},()=>"\u0000".repeat(100))});
  assert.ok(new TextEncoder().encode(JSON.stringify(escaped)).length<20000);
});
test("offline queue restores messages and draft across reload, isolates accounts and clears on logout",async t=>{
  const cache=browser(),owner=randomUUID();Object.defineProperty(navigator,"onLine",{value:false});
  t.mock.method(globalThis,"fetch",async()=>{throw Error("offline");});
  const a=new CoachHistoryClient(owner);a.activate();const complete=turn(),partial={...turn("慢回复"),pending:true};
  a.setTurns([complete,partial]);a.setText("还没有发送的消息");assert.equal(a.snapshot().sync,"offline");
  const b=new CoachHistoryClient(owner);b.activate();assert.equal(b.snapshot().id,a.snapshot().id);assert.equal(b.snapshot().text,"还没有发送的消息");
  assert.equal(b.snapshot().turns.length,2);assert.equal(b.snapshot().turns.find(t=>t.id===partial.id)?.interrupted,true);
  assert.equal(conversationHistory(b.snapshot().turns).length,2);
  const other=new CoachHistoryClient(randomUUID());other.activate();assert.deepEqual(other.snapshot().turns,[]);
  assert.ok(cache.get(`liftcut-chat-history:${owner}`));b.dispose();assert.equal(cache.get(`liftcut-chat-history:${owner}`),undefined);
  await settle();
});
test("an in-flight pending upload cannot mark a newer complete reply saved, and chunks do not create uploads",async t=>{
  browser();const batches:HistoryItem[][]=[];let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});
  t.mock.method(globalThis,"fetch",async(_url:RequestInfo|URL,options?:RequestInit)=>{
    if(options?.method==="POST"){batches.push(JSON.parse(options.body as string).items);if(batches.length===1)await gate;return Response.json({saved:true});}
    return Response.json({items:[],next:null});
  });
  const a=new CoachHistoryClient(randomUUID());a.activate();const base=turn();
  a.setTurns([{...base,pending:true,lines:["部"]}]);await settle();
  for(const lines of [["部分"],["部分文字"]])a.setTurns([{...base,pending:true,lines}]);
  assert.equal(batches.length,1);assert.equal(batches[0][0].turn.lines,undefined);
  a.setTurns([{...base,pending:false}]);release();await settle();await a.flush();
  assert.equal(batches.length,2);assert.equal(batches[1][0].revision,2);assert.deepEqual(batches[1][0].turn.lines,["完整回答"]);
  assert.equal(a.snapshot().sync,"saved");a.dispose();
});
test("failed upload remains retryable; late history response never replaces a new conversation",async t=>{
  browser();let fail=true,release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),old=turn();
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,options?:RequestInit)=>{
    if(options?.method==="POST")return Response.json({}, {status:fail?503:200});
    if(String(url).includes("?id=")){await gate;return Response.json({items:[{turn:old,revision:1}],next:null});}
    return Response.json({items:[],next:null});
  });
  const a=new CoachHistoryClient(randomUUID());a.activate();a.setTurns([turn()]);await settle();assert.equal(a.snapshot().sync,"error");
  fail=false;await a.flush();assert.equal(a.snapshot().sync,"saved");
  const selecting=a.select(randomUUID());a.newConversation();const id=a.snapshot().id;release();await selecting;
  assert.equal(a.snapshot().id,id);assert.deepEqual(a.snapshot().turns,[]);a.dispose();
});
test("a confirmed remote deletion clears a synced cached conversation after reload",async t=>{
  browser();let deleted=false;
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,options?:RequestInit)=>{
    if(options?.method==="POST")return Response.json({saved:true});
    if(String(url).includes("?id="))return Response.json({}, {status:deleted?404:503});
    return Response.json({items:[],next:null});
  });
  const owner=randomUUID(),a=new CoachHistoryClient(owner);a.activate();a.setTurns([turn()]);await settle();await a.flush();const id=a.snapshot().id;
  deleted=true;const reloaded=new CoachHistoryClient(owner);reloaded.activate();await settle();
  assert.notEqual(reloaded.snapshot().id,id);assert.deepEqual(reloaded.snapshot().turns,[]);reloaded.dispose();a.dispose();
});
