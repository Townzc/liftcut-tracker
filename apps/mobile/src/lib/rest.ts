// Pure rest-timer arithmetic: wall-clock based, so a suspended app resumes with the right time.
export const REST_PRESETS = [60, 90, 120, 180] as const;
export type RestRun = { endsAt: number; total: number };
export const startRest = (seconds: number, now: number): RestRun => ({ endsAt: now + seconds * 1000, total: seconds });
export const extendRest = (run: RestRun, seconds = 30): RestRun => ({ endsAt: run.endsAt + seconds * 1000, total: run.total + seconds });
export const remaining = (run: RestRun, now: number) => Math.min(run.total, Math.max(0, Math.ceil((run.endsAt - now) / 1000)));
export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const validPreset = (value: unknown) => REST_PRESETS.find(p => p === Number(value)) ?? 90;
