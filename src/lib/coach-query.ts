/** Conservative read-ahead, not a replacement intent parser. Only explicit record
 * questions with one recognized period. Anything ambiguous uses model tools. */
export function initialRecordQuery(text:string,anchor:string):{topic:"body"|"food"|"workout";alsoTopics:("body"|"food"|"workout")[];from:string;to:string}|null {
  const s=text.normalize("NFKC").toLowerCase();
  if(/怎么|如何|解释|意思|\bhow to\b/.test(s))return null;
  if(s.length>180||/["'“”「」`]/.test(s)||/不要|不查|别查|计划|目标|建议|生成|制定|调整|修改|更正|删除|补录|添加|保存|记下|记一下|帮我记|假设|如果|本次|比较|对比|相比|之间|到|至|上周|上月|去年|前年|今年|本月|\b(plan|target|advice|generate|adjust|change|correct|delete|add|save|log|record|if|not|compare|between|month|year|last week|current session)\b/.test(s))return null;
  if(!/记录|数据|\b(records|logs|data)\b/.test(s)||!/查|核对|看看|列出|汇总|多少|哪些|什么|\b(show|check|list|summarize|what|how many)\b/.test(s))return null;
  const patterns=[
    {re:/前天|day before yesterday/g,days:1,offset:-2},
    {re:/昨天|yesterday/g,days:1,offset:-1},
    {re:/今天|今日|\btoday\b/g,days:1,offset:0},
    {re:/(?:最近|过去|近)(?:一周|7天|七天)|\b(?:past|last) (?:7|seven) days\b/g,days:7,offset:0},
    {re:/(?:最近|过去|近)(?:28天|二十八天)|\b(?:past|last) 28 days\b/g,days:28,offset:0},
    {re:/本周|这周|\bthis week\b/g,days:new Date(anchor+"T12:00:00Z").getUTCDay()||7,offset:0},
  ];
  // Consume longer expressions first so "前天"/"day before yesterday" do not
  // count twice. Unknown temporal/numeric constraints must not broaden a read.
  let rest=s,period:{days:number;offset:number}|undefined,count=0;
  for(const p of patterns)rest=rest.replace(p.re,()=>{period=p;count++;return " ";});
  if(count!==1||!period||/\d|前|后|天|周|月|年|最近|过去|之前|之后|before|after|ago|recent|week|day|tomorrow|tonight|next|previous|future/.test(rest))return null;
  const topics:("body"|"food"|"workout")[]=[];
  if(/身体|体重|腰围|\b(body|weight|waist)\b/.test(s))topics.push("body");
  if(/饮食|食物|吃的|热量|蛋白质|\b(food|meal|meals|calories|protein)\b/.test(s))topics.push("food");
  if(/训练|运动|\b(workout|workouts|training)\b/.test(s))topics.push("workout");
  if(!topics.length)return null;
  const day=(offset:number)=>{const d=new Date(anchor+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
  return {topic:topics[0],alsoTopics:topics.slice(1),from:day(period.offset-period.days+1),to:day(period.offset)};
}
