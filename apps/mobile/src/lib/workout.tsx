import type { OutboxState } from "@liftcut/core/workout-outbox";
import { createContext, use, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { MobileOutbox } from "./outbox";
import { outboxApi } from "./outbox-api";
import { outboxStore } from "./outbox-store";
import { useSession } from "./session";

const Workout = createContext<{ outbox: MobileOutbox | null; state: OutboxState | null } | null>(null);

/** One queue per account, kept in SQLite and shared by every screen: it survives restarts and never mixes accounts. */
export function WorkoutProvider({ children }: PropsWithChildren) {
  const { session: auth } = useSession(), authRef = useRef(auth); authRef.current = auth;
  const owner = auth?.user.id, [state, setState] = useState<OutboxState | null>(null);
  const outbox = useMemo(() => owner ? new MobileOutbox(owner, outboxStore, outboxApi(() => authRef.current), setState) : null, [owner]);
  const value = useMemo(() => ({ outbox, state: state?.owner === owner ? state : null }), [outbox, state, owner]);
  return <Workout.Provider value={value}>{children}</Workout.Provider>;
}
export function useWorkout() {
  const value = use(Workout);
  if (!value) throw new Error("useWorkout must be used inside WorkoutProvider");
  return value;
}
