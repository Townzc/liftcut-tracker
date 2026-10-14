import test from "node:test";
import assert from "node:assert/strict";
import {streamingReply,consumeCoachStream} from "../src/lib/coach-stream";
import {conversationHistory} from "../src/lib/coach-model";
const encoder=new TextEncoder();
const result={requestId:"request",message:"好了",sources:[],provider:"fixture",model:"fixture"};

test("only source-first reply prose is streamed, with complete escapes and Unicode",()=>{
  const value=JSON.stringify({sourceIds:["body:today"],message:'你好 "测试"\\\n🏀 完成'});
  let previous="";
  for(let i=0;i<=value.length;i++){
    const partial=streamingReply(value.slice(0,i));
    if(partial){assert.ok(partial.text.startsWith(previous));previous=partial.text;assert.deepEqual(partial.sourceIds,["body:today"]);}
  }
  assert.equal(previous,JSON.parse(value).message);
  assert.equal(streamingReply('{"sourceIds":[],"message":"a\\uD83C')?.text,"a");
  assert.equal(streamingReply('{"sourceIds":[],"message":"a\\uD83C\\uDFC0')?.text,"a🏀");
  for(const raw of ['{"message":"not framed"','{"plan":{"message":"not a reply"}', '{"sourceIds":[123],"message":"bad"','{"sourceIds":[],"message":"bad\\q"'])assert.equal(streamingReply(raw),null);
});

test("text arrives before a delayed terminal result across split UTF-8 bytes",async()=>{
  let stream!:ReadableStreamDefaultController<Uint8Array>;
  const events:string[]=[];
  const response=new Response(new ReadableStream({start(c){stream=c;}}));
  let complete=false;
  const pending=consumeCoachStream(response,"request",e=>{if(e.type==="text")events.push(e.text);},new AbortController().signal).then(r=>{complete=true;return r;});
  const bytes=encoder.encode(JSON.stringify({type:"text",text:"你好🏀"})+"\n");
  for(const byte of bytes)stream.enqueue(new Uint8Array([byte]));
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(events,["你好🏀"]);assert.equal(complete,false);
  stream.enqueue(encoder.encode(JSON.stringify({type:"result",result})+"\n"));
  stream.close();
  assert.deepEqual(await pending,result);
});

test("truncated, failed, oversized and mismatched streams never return a proposal",async()=>{
  for(const content of ['{"type":"text","text":"partial"}\n',JSON.stringify({type:"result",result:{...result,requestId:"other"}})+"\n",'{"type":"error","error":"RATE_LIMITED"}\n',' '.repeat(1024*1024+1)]){
    await assert.rejects(consumeCoachStream(new Response(content),"request",()=>{},new AbortController().signal));
  }
});

test("stop cancels the reader and incomplete replies stay out of conversation memory",async()=>{
  let cancelled=false;
  const controller=new AbortController();
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  const pending=consumeCoachStream(response,"request",()=>{},controller.signal);
  controller.abort();await assert.rejects(pending);assert.equal(cancelled,true);
  assert.deepEqual(conversationHistory([{text:"first",reply:"data",lines:["partial"],pending:true},{text:"second",reply:"data",lines:["failed"],interrupted:true},{text:"third",reply:"data",lines:["complete"]}]),[{role:"user",content:"third"},{role:"assistant",content:"complete"}]);
});
