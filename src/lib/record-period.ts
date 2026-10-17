import { recordDate } from "./personal-records";

export type RecordPeriod = {kind:"range";from:string;to:string} | {kind:"none"|"unsupported"};
const integer = (s:string) => {
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const digits:Record<string,number>={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if(s in digits)return digits[s];
  if(/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(s)){
    const [a,b]=s.split("十");return (a?digits[a]:1)*10+(b?digits[b]:0);
  }
  return ({one:1,two:2,three:3,six:6,twelve:12} as Record<string,number>)[s]??NaN;
};
const day = (anchor:string,offset:number) => {
  const d=new Date(anchor+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);
};
function monthsAgo(anchor:string,months:number){
  const d=new Date(anchor+"T12:00:00Z"),date=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(date,last));return d.toISOString().slice(0,10);
}

/** Shared local/model read boundary. Calendar months, never an assumed 30 days.
 * Unrecognized or multiple time constraints must not silently become "recent". */
export function recordPeriod(input:string,anchor:string):RecordPeriod {
  if(!recordDate.safeParse(anchor).success)return {kind:"unsupported"};
  let rest=input.normalize("NFKC").toLowerCase(),count=0,from="",to="";
  const take=(pattern:RegExp,resolve:(match:string,...groups:string[])=>[string,string])=>{
    rest=rest.replace(pattern,(match,...args)=>{
      count++;[from,to]=resolve(match,...args.slice(0,-2));return " ";
    });
  };
  take(/\d{4}-\d{2}-\d{2}/g,s=>[s,s]);
  take(/([\d一二两三四五六七八九十]+)\s*(?:个)?(月|年|周|天)前/g,(_,n,unit)=>{
    const amount=integer(n);if(!Number.isFinite(amount)||amount<1||amount>120)return ["",""];
    const date=unit==="月"||unit==="年"?monthsAgo(anchor,amount*(unit==="年"?12:1)):day(anchor,-amount*(unit==="周"?7:1));return [date,date];
  });
  take(/\b(\d{1,3}|one|two|three|six|twelve) (days?|weeks?|months?|years?) ago\b/g,(_,n,unit)=>{
    const amount=integer(n);if(amount<1||amount>120)return ["",""];
    const date=/month|year/.test(unit)?monthsAgo(anchor,amount*(unit.startsWith("year")?12:1)):day(anchor,-amount*(unit.startsWith("week")?7:1));return [date,date];
  });
  take(/前天|\b(?:the )?day before yesterday\b/g,()=>[day(anchor,-2),day(anchor,-2)]);
  take(/昨天|\byesterday\b/g,()=>[day(anchor,-1),day(anchor,-1)]);
  take(/今天|今日|\btoday\b/g,()=>[anchor,anchor]);
  take(/(?:最近|过去|近)(一周|\d{1,3}天|[一二两三四五六七八九十]+天)|\b(?:past|last) (\d{1,3}|seven) days\b/g,(_,zh,en)=>{
    const n=zh==="一周"?7:en==="seven"?7:integer((zh??en).replace(/天$/,""));
    return Number.isFinite(n)&&n>=1&&n<=93?[day(anchor,1-n),anchor]:["",""];
  });
  take(/本周|这周|\bthis week\b/g,()=>[day(anchor,1-(new Date(anchor+"T12:00:00Z").getUTCDay()||7)),anchor]);
  // Leave unsupported months, ranges, comparisons and qualifiers for clarification.
  if(count>1||/\d|前|后|天|周|月|年|过去|之前|之后|到|至|比较|对比|相比|between|compare|before|after|ago|week|month|year|day|tomorrow|tonight|next|previous|future/.test(rest))return {kind:"unsupported"};
  if(!count)return {kind:"none"};
  if(!recordDate.safeParse(from).success||!recordDate.safeParse(to).success||from>to||to>anchor)return {kind:"unsupported"};
  return {kind:"range",from,to};
}
