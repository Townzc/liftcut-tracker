import {test} from "node:test";
import assert from "node:assert/strict";
import {workoutEvidenceReply,workoutReplyPolicy,workoutPendingReport} from "../src/lib/workout-evidence-reply";
import type {Session} from "@liftcut/core/today";

test("completion claims in the question cannot become confirmed records in a progress answer",()=>{
  const session={prescription:{exercises:[{id:"a",name:"划船",sets:3},{id:"b",name:"俯卧撑",sets:2}]},
    sets:[{planExerciseId:"b",status:"done"},{planExerciseId:"a",status:"voided"}]} as Session;
  const answer=workoutEvidenceReply(session,"我的训练是不是还差一个动作？划船做完了",false)!;
  assert.match(answer,/已确认完成的记录：俯卧撑 1组/);
  assert.match(answer,/划船 0\/3/);assert.match(answer,/作废记录不计入/);
  assert.doesNotMatch(answer,/已确认完成的记录：划船/);
});

test("approximate effort remains uncertain in prose; normal reports and plan requests keep the model route",()=>{
  const session={prescription:{exercises:[]},sets:[]} as unknown as Session;
  assert.match(workoutEvidenceReply(session,"划船这组RPE大概8，做了9次",false)!,/RPE还有不确定/);
  assert.equal(workoutReplyPolicy("肩推左右各17公斤，11次"),null);
  assert.equal(workoutReplyPolicy("帮我安排下周的训练计划"),null);
  assert.equal(workoutReplyPolicy("今天体重好像变了"),null);
  assert.equal(workoutPendingReport("谢谢，知道了"),false);
  assert.equal(workoutPendingReport("帮我查询已保存的组数"),false);
  assert.equal(workoutPendingReport("刚做完一组，还没看次数"),true);
});
