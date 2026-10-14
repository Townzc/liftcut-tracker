// Scripted OpenAI-compatible HTTP double. NEVER real-model evaluation evidence.
// All UI/API/auth-boundary and PostgreSQL writes still execute application code.
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
function call(name:string,args:unknown){return {id:"call_"+randomUUID(),type:"function",function:{name,arguments:JSON.stringify(args)}};}
const bodyEmpty={dateQuote:null,weightQuote:null,waistQuote:null};
const foodEmpty={dateQuote:null,foodQuote:null,mealQuote:null,caloriesQuote:null,proteinQuote:null};
createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json");
  if(req.method==="GET"){res.end('{"fixture":"scripted, not a model"}');return;}
  let raw="";for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),messages=body.messages as {role:string;content:string;tool_calls?:{id:string;function:{name:string}}[];tool_call_id?:string}[];
  const current=messages.findLastIndex(x=>x.role==="user"),text=messages[current]?.content??"";
  const since=messages.slice(current+1),lastTool=since.filter(x=>x.role==="tool").at(-1);
  const priorCall=lastTool?since.flatMap(x=>x.tool_calls??[]).find(x=>x.id===lastTool.tool_call_id):undefined;
  let result=null;try{result=lastTool?JSON.parse(lastTool.content):null;}catch{result={error:lastTool?.content};}
  const today=/Today in the user's timezone is (\d{4}-\d{2}-\d{2})/.exec(messages[0].content)?.[1]??"2026-10-14";
  const shifted=(n:number)=>{const d=new Date(today+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  if(text.includes("[provider-down]")){res.statusCode=503;res.end('{"error":{"message":"synthetic provider unavailable"}}');return;}
  if(text.includes("[slow]")){await new Promise(r=>setTimeout(r,15000));}
  let chosen;
  if(priorCall?.function.name==="read_records"){
    const food=text.includes("午餐")||text.includes("吃了")||text.includes("food");
    chosen=text.includes("昨天呢")&&since.filter(x=>x.role==="tool").length===1?
      call("read_records",{topic:"body",from:shifted(-1),to:shifted(-1)}):call("finish_response",{message:result.error?"暂时无法读取记录。":food?`已查到 ${result.summary.recordCount} 条饮食记录。未填写的热量和蛋白质保持未知。`:
      `已查到 ${result.summary.recordCount} 条身体记录，最近体重 ${result.summary.latestWeightKg??"未知"} kg。`,sourceIds:result.id?[result.id]:[]});
  }else if(priorCall?.function.name==="current_workout"){
    const exercise=result.exercises?.find((x:{name:string})=>x.name==="深蹲")??result.exercises?.[0];
    chosen=text.includes("[current-read]")?call("finish_response",{message:"本次已记录的实际组，请核对来源。",sourceIds:[]}):exercise?call("prepare_workout",{exerciseId:exercise.id,kind:"record",weightQuote:"五十公斤",repsQuotes:["八次"],rpeQuote:null,rpeScope:null,correctionSet:null}):call("finish_response",{message:"请先开始本次训练。",sourceIds:[]});
  }else if(priorCall?.function.name==="prepare_body"&&text.includes("[oral-append]")){
    if(result.draft){res.statusCode=503;res.end('{"error":{"message":"The valid draft must return without another provider call"}}');return;}
    chosen=call("prepare_body",{...bodyEmpty,dateQuote:"现在",weightQuote:"七十三点一公斤"});
  }else if(priorCall?.function.name?.startsWith("prepare_")){
    chosen=call("finish_response",{message:result.ok===false?"请补充明确的数值和单位，我没有保存数据。":"整理好了，请核对下方草稿并确认。尚未保存。",sourceIds:[]});
  }else if(text.includes("[invent]")){
    chosen=call("prepare_body",{...bodyEmpty,weightQuote:"82公斤"});
  }else if(text.includes("[oral-append]")){
    // Deliberately wrong cross-topic field must fail schema validation, then be
    // corrected. A valid draft must not depend on a further model response.
    chosen=call("prepare_body",{...bodyEmpty,dateQuote:"现在",weightQuote:"七十三点一公斤",foodQuote:"一碗牛肉面"});
  }else if(text.includes("称")||text.includes("秤")){
    chosen=call("prepare_body",{...bodyEmpty,weightQuote:"七十二点五公斤",dateQuote:text.includes("昨天")?"昨天":null});
  }else if(text.includes("吃了一碗牛肉面")){
    chosen=call("prepare_food",{...foodEmpty,foodQuote:"一碗牛肉面",mealQuote:"中午"});
  }else if(text.includes("实打实")||text.includes("[current-read]"))chosen=call("current_workout",{});
  else if(text.includes("体重")||text.includes("昨天呢")||text.includes("午餐")||text.includes("吃了")){
    chosen=call("read_records",{topic:text.includes("午餐")||text.includes("吃了")?"food":"body",from:text.includes("昨天")?shifted(-1):shifted(-27),to:text.includes("昨天")?shifted(-1):today});
  }else chosen=call("finish_response",{message:"你好，可以自然地问我记录，也可以告诉我今天的变化。",sourceIds:[]});
  res.end(JSON.stringify({id:"fixture_"+randomUUID(),object:"chat.completion",created:Math.floor(Date.now()/1000),model:"scripted-coach-fixture",choices:[{index:0,finish_reason:"tool_calls",message:{role:"assistant",content:null,tool_calls:[chosen]}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));
}).listen(59999,"127.0.0.1",()=>console.log("Scripted model fixture on loopback:59999; no external model calls"));
