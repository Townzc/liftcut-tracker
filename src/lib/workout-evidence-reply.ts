import type {Session} from "@liftcut/core/today";

export function workoutPendingReport(text:string):boolean {
  return !/[?？]|是不是|有没有|查询|明天|计划|安排|\b(?:plan|tomorrow|query)\b/i.test(text)
    && /组|次数|RPE|做完|练完|重做|跳过|sets?|reps?|redo/i.test(text);
}

/** These replies assert database state or uncertainty, not model inference. */
export function workoutReplyPolicy(text:string):"progress"|"uncertain"|null {
  const workout=/训练|动作|(?:第|做了|练了).{0,4}组|卧推|深蹲|硬拉|划船|弯举|肩推|侧平举|下压|workout|sets?|RPE/i.test(text);
  if(workout&&/是不是.*还差|有没有漏记|训练.*完成情况|还(?:差|剩).*动作|workout.*(?:missing|progress)|missing.*sets/i.test(text))return "progress";
  if(workout&&!/[?？]|是不是|有没有/.test(text)&&/不确定|记不清|忘记|忘了|好像|大概|差不多|可能|也许|应该|左右(?!各)|十几个|maybe|unsure|about|around/i.test(text))return "uncertain";
  return null;
}

export function workoutEvidenceReply(session:Session,text:string,en:boolean):string|null {
  const policy=workoutReplyPolicy(text);
  if(policy==="uncertain"){
    const rpe=/RPE/i.test(text);
    return en?`The ${rpe?"RPE":"set count or repetitions"} is still uncertain. This report has not been saved as workout data. Please clarify the uncertain quantities, or explicitly keep them unknown; a set needs a reported repetition count before its confirmation card can be prepared.`
      :`${rpe?"RPE":"组数或次数"}还有不确定之处，这条描述尚未保存为训练记录. 请确认仍不确定的数字，或明确保留未知；生成组记录的确认卡还需要明确的实际次数.`;
  }
  if(policy!=="progress")return null;
  const completed:string[]=[],skipped:string[]=[],unrecorded:string[]=[];
  for(const e of session.prescription.exercises){
    const sets=session.sets.filter(s=>s.planExerciseId===e.id),done=sets.filter(s=>s.status==="done").length;
    const skip=sets.filter(s=>s.status==="skipped").length;
    if(done)completed.push(`${e.name} ${done}${en?" sets":"组"}`);
    if(skip)skipped.push(`${e.name} ${skip}${en?" sets":"组"}`);
    if(done+skip<e.sets)unrecorded.push(`${e.name} ${done+skip}/${e.sets}`);
  }
  const voided=session.sets.filter(s=>s.status==="voided").length;
  return en?`Confirmed completed records: ${completed.join(", ")||"none"}. Confirmed skips: ${skipped.join(", ")||"none"}.${voided?` ${voided} voided sets are excluded.`:""}\nIncomplete recording (done + skipped / planned): ${unrecorded.join(", ")||"none"}. Missing records do not mean you did not perform the exercise. Report the actual quantities you want to add, then confirm the preview.`
    :`已确认完成的记录：${completed.join("、")||"暂无"}. 已确认跳过：${skipped.join("、")||"暂无"}.${voided?` ${voided} 组作废记录不计入完成数.`:""}\n尚未记全（已完成 + 已跳过 / 计划组数）：${unrecorded.join("、")||"暂无"}. 没有记录不等于没有做. 把需要补记的动作和实际次数告诉我，核对确认卡后再保存.`;
}
