import { projectOutbox, type OutboxState, type WorkoutOperation } from "@liftcut/core/workout-outbox";
import { storedSet, workoutCanonical } from "@liftcut/core/workout-context";
import type { TodayData } from "@liftcut/core/today";

function comparable(data:TodayData) {
  // Only the server timestamp differs from an optimistic set. Keep every other
  // field, including provenance, per-hand load, owner, prescription and revisions.
  return {...data,session:data.session && {...data.session,
    sets:data.session.sets.map(s=>({...storedSet(s),exerciseName:s.exerciseName}))}};
}

/** Transaction-local exception for a known set ack, never a general stale retry. */
export function canFollowSetAcknowledgement(owner:string,action:WorkoutOperation["action"],before:OutboxState,after:OutboxState) {
  if((action!=="set" && action!=="end") || before.owner!==owner || after.owner!==owner
    || before.version!==1 || after.version!==1 || before.confirmed?.session?.userId!==owner
    || after.confirmed?.session?.userId!==owner) return false;
  const removed=before.items.length-after.items.length;
  // Exactly one semantic storage revision per ack; retries/discards/new work
  // cannot masquerade as removal even if their final projection happens to match.
  if(removed<=0 || after.revision-before.revision!==removed
    || before.items.some(i=>i.status==="auth" || i.status==="conflict")
    || before.items.slice(0,removed).some(i=>i.action!=="set")
    || workoutCanonical(before.items.slice(removed))!==workoutCanonical(after.items)
    || workoutCanonical(before.discarded)!==workoutCanonical(after.discarded)) return false;
  const acknowledged=projectOutbox({...before,items:before.items.slice(0,removed)});
  return !acknowledged.error && !!acknowledged.data && !!after.confirmed
    && workoutCanonical(comparable(acknowledged.data))===workoutCanonical(comparable(after.confirmed));
}
