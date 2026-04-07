import type { AiNutritionPlan, AiTrainingPlan } from "@/lib/ai/schemas";

export const GUEST_COOKIE_NAME = "liftcut_guest";
export const GUEST_COOKIE_VALUE = "1";
export const GUEST_USER_ID = "guest-local";
export const GUEST_MODE_STORAGE_KEY = "liftcut-guest-mode";
const GUEST_AI_HISTORY_STORAGE_KEY = "liftcut-guest-ai-history";
const GUEST_AI_QUOTA_STORAGE_KEY = "liftcut-guest-ai-quota";
const GUEST_SAVED_NUTRITION_PLAN_STORAGE_KEY = "liftcut-guest-saved-nutrition-plan";

export type GuestAiHistoryType = "training" | "nutrition";

export interface GuestAiHistoryItem {
  id: string;
  type: GuestAiHistoryType;
  model_name: string;
  prompt_version: string;
  status: "success" | "failed" | "draft";
  goal_type: "fat_loss" | "muscle_gain" | "maintenance" | "recomposition";
  parsed_plan_json: unknown;
  raw_response_json?: unknown;
  error_message?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface GuestAiHistoryState {
  training: GuestAiHistoryItem[];
  nutrition: GuestAiHistoryItem[];
}

interface GuestAiQuotaState {
  date: string;
  count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearStorage(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(key);
}

function createHistoryId(type: GuestAiHistoryType): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `guest-${type}-${crypto.randomUUID()}`;
  }

  return `guest-${type}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeGoalType(input: unknown): GuestAiHistoryItem["goal_type"] {
  const raw = String(input ?? "").toLowerCase();
  if (raw === "fat_loss" || raw === "muscle_gain" || raw === "maintenance" || raw === "recomposition") {
    return raw;
  }

  return "fat_loss";
}

export function setGuestCookie(enabled: boolean): void {
  if (typeof document === "undefined") {
    return;
  }

  if (enabled) {
    document.cookie = `${GUEST_COOKIE_NAME}=${GUEST_COOKIE_VALUE}; path=/; max-age=31536000; samesite=lax`;
    return;
  }

  document.cookie = `${GUEST_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export function isGuestModeEnabled(): boolean {
  return readStorage<boolean>(GUEST_MODE_STORAGE_KEY, false);
}

export function setGuestModeEnabled(enabled: boolean): void {
  writeStorage<boolean>(GUEST_MODE_STORAGE_KEY, enabled);
  setGuestCookie(enabled);
}

export function getGuestAiHistory(): GuestAiHistoryState {
  return readStorage<GuestAiHistoryState>(GUEST_AI_HISTORY_STORAGE_KEY, {
    training: [],
    nutrition: [],
  });
}

export function setGuestAiHistory(state: GuestAiHistoryState): void {
  writeStorage(GUEST_AI_HISTORY_STORAGE_KEY, state);
}

export function hasGuestAiHistory(): boolean {
  const history = getGuestAiHistory();
  return history.training.length > 0 || history.nutrition.length > 0;
}

export function pushGuestTrainingHistory(input: {
  modelName: string;
  promptVersion: string;
  parsedPlan: AiTrainingPlan;
  rawResponse?: unknown;
  status?: "success" | "failed" | "draft";
  errorMessage?: string | null;
}): GuestAiHistoryItem {
  const history = getGuestAiHistory();
  const item: GuestAiHistoryItem = {
    id: createHistoryId("training"),
    type: "training",
    model_name: input.modelName,
    prompt_version: input.promptVersion,
    status: input.status ?? "success",
    goal_type: normalizeGoalType(input.parsedPlan.goal_type),
    parsed_plan_json: input.parsedPlan,
    raw_response_json: input.rawResponse ?? input.parsedPlan,
    error_message: input.errorMessage ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  setGuestAiHistory({
    ...history,
    training: [item, ...history.training],
  });

  return item;
}

export function pushGuestNutritionHistory(input: {
  modelName: string;
  promptVersion: string;
  parsedPlan: AiNutritionPlan;
  rawResponse?: unknown;
  status?: "success" | "failed" | "draft";
  errorMessage?: string | null;
}): GuestAiHistoryItem {
  const history = getGuestAiHistory();
  const item: GuestAiHistoryItem = {
    id: createHistoryId("nutrition"),
    type: "nutrition",
    model_name: input.modelName,
    prompt_version: input.promptVersion,
    status: input.status ?? "success",
    goal_type: normalizeGoalType(input.parsedPlan.goal_type),
    parsed_plan_json: input.parsedPlan,
    raw_response_json: input.rawResponse ?? input.parsedPlan,
    error_message: input.errorMessage ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  setGuestAiHistory({
    ...history,
    nutrition: [item, ...history.nutrition],
  });

  return item;
}

export function deleteGuestAiHistoryItem(type: GuestAiHistoryType, id: string): void {
  const history = getGuestAiHistory();
  if (type === "training") {
    setGuestAiHistory({
      ...history,
      training: history.training.filter((item) => item.id !== id),
    });
    return;
  }

  setGuestAiHistory({
    ...history,
    nutrition: history.nutrition.filter((item) => item.id !== id),
  });
}

export function clearGuestAiHistory(type: GuestAiHistoryType | "all"): void {
  const history = getGuestAiHistory();

  if (type === "all") {
    setGuestAiHistory({ training: [], nutrition: [] });
    return;
  }

  if (type === "training") {
    setGuestAiHistory({ ...history, training: [] });
    return;
  }

  setGuestAiHistory({ ...history, nutrition: [] });
}

export function getGuestAiQuotaState(): GuestAiQuotaState {
  const fallback: GuestAiQuotaState = { date: todayKey(), count: 0 };
  const state = readStorage<GuestAiQuotaState>(GUEST_AI_QUOTA_STORAGE_KEY, fallback);

  if (state.date !== todayKey()) {
    return fallback;
  }

  return state;
}

export function canConsumeGuestAiQuota(limit: number): boolean {
  const state = getGuestAiQuotaState();
  return state.count < limit;
}

export function consumeGuestAiQuota(limit: number): { allowed: boolean; remaining: number; used: number } {
  const state = getGuestAiQuotaState();
  if (state.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      used: state.count,
    };
  }

  const nextCount = state.count + 1;
  writeStorage<GuestAiQuotaState>(GUEST_AI_QUOTA_STORAGE_KEY, {
    date: todayKey(),
    count: nextCount,
  });

  return {
    allowed: true,
    remaining: Math.max(0, limit - nextCount),
    used: nextCount,
  };
}

export function saveGuestNutritionPlan(plan: AiNutritionPlan): void {
  writeStorage(GUEST_SAVED_NUTRITION_PLAN_STORAGE_KEY, {
    plan,
    savedAt: nowIso(),
  });
}

export function clearGuestSessionArtifacts(): void {
  clearStorage(GUEST_MODE_STORAGE_KEY);
  clearStorage(GUEST_AI_HISTORY_STORAGE_KEY);
  clearStorage(GUEST_AI_QUOTA_STORAGE_KEY);
  clearStorage(GUEST_SAVED_NUTRITION_PLAN_STORAGE_KEY);
  setGuestCookie(false);
}
