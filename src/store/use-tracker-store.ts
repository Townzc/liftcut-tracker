"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  createDefaultSettings,
  createDemoTrainingPlan,
  createEmptyTrainingPlan,
  defaultQuickFoods,
} from "@/lib/demo-data";
import { createAuthRequiredError } from "@/lib/error-utils";
import { GUEST_USER_ID } from "@/lib/guest-mode";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  deleteTrainingPlan as removeTrainingPlan,
  fetchUserDataBundle,
  removeBodyMetricLog,
  removeFoodLog,
  saveTrainingPlan,
  setActiveTrainingPlan,
  upsertBodyMetricLog,
  upsertFoodLog,
  upsertUserSettings,
  upsertWorkoutLog,
} from "@/services/data-repository";
import type {
  AppDataSnapshot,
  AuthMode,
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  TrainingPlanSummary,
  UserSettings,
  WorkoutLog,
} from "@/types";

function nowIso(): string {
  return new Date().toISOString();
}

function safeRandomId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function createEmptySnapshot(userId: string): AppDataSnapshot {
  return {
    settings: createDefaultSettings(userId),
    trainingPlan: createDemoTrainingPlan(userId),
    workoutLogs: [],
    foodLogs: [],
    bodyMetricLogs: [],
    quickFoods: defaultQuickFoods,
  };
}

function sortWorkoutLogs(logs: WorkoutLog[]): WorkoutLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function sortFoodLogs(logs: FoodLog[]): FoodLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function sortBodyLogs(logs: BodyMetricLog[]): BodyMetricLog[] {
  return [...logs].sort((a, b) => {
    if (a.date === b.date) {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.date.localeCompare(a.date);
  });
}

function toTrainingPlanSummary(plan: TrainingPlan): TrainingPlanSummary {
  return {
    id: plan.id,
    userId: plan.userId,
    name: plan.name,
    notes: plan.notes || "",
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function listFromPlan(plan: TrainingPlan): TrainingPlanSummary[] {
  if (!plan.id || plan.weeks.length === 0) {
    return [];
  }

  return [{ ...toTrainingPlanSummary(plan), isActive: true }];
}

function upsertSummaryList(
  list: TrainingPlanSummary[],
  nextItem: TrainingPlanSummary,
  options?: { setActive?: boolean },
): TrainingPlanSummary[] {
  const filtered = list.filter((item) => item.id !== nextItem.id);
  const normalizedNew = {
    ...nextItem,
    isActive: options?.setActive ? true : nextItem.isActive,
  };

  const merged = [normalizedNew, ...filtered].map((item) => {
    if (!options?.setActive) {
      return item;
    }

    return {
      ...item,
      isActive: item.id === normalizedNew.id,
    };
  });

  return merged;
}

function normalizeSnapshotForUser(snapshot: AppDataSnapshot, userId: string): AppDataSnapshot {
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      userId,
    },
    trainingPlan: {
      ...snapshot.trainingPlan,
      userId,
    },
    workoutLogs: snapshot.workoutLogs.map((log) => ({
      ...log,
      userId,
    })),
    foodLogs: snapshot.foodLogs.map((log) => ({
      ...log,
      userId,
    })),
    bodyMetricLogs: snapshot.bodyMetricLogs.map((log) => ({
      ...log,
      userId,
    })),
  };
}

function createGuestSnapshotFromState(state: TrackerState): AppDataSnapshot {
  return normalizeSnapshotForUser(
    {
      settings: state.settings,
      trainingPlan: state.trainingPlan,
      workoutLogs: state.workoutLogs,
      foodLogs: state.foodLogs,
      bodyMetricLogs: state.bodyMetricLogs,
      quickFoods: state.quickFoods,
    },
    GUEST_USER_ID,
  );
}

function hasMeaningfulGuestData(snapshot: AppDataSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }

  const hasSettings =
    snapshot.settings.gender !== "unknown" ||
    snapshot.settings.age > 0 ||
    snapshot.settings.height > 0 ||
    snapshot.settings.currentWeight > 0 ||
    snapshot.settings.targetWeight > 0 ||
    snapshot.settings.weeklyTrainingDays > 0 ||
    snapshot.settings.calorieTarget > 0 ||
    snapshot.settings.proteinTarget > 0 ||
    snapshot.settings.availableEquipment.length > 0 ||
    snapshot.settings.foodRestrictions.trim().length > 0 ||
    snapshot.settings.injuryNotes.trim().length > 0 ||
    snapshot.settings.lifestyleNotes.trim().length > 0;

  const hasLogs =
    snapshot.workoutLogs.length > 0 ||
    snapshot.foodLogs.length > 0 ||
    snapshot.bodyMetricLogs.length > 0;

  return hasSettings || hasLogs;
}

function isGuestMode(state: TrackerState): boolean {
  return state.authMode === "guest" || state.userId === GUEST_USER_ID;
}

async function resolveUserId(userId: string | null): Promise<string> {
  if (userId && userId !== GUEST_USER_ID) {
    return userId;
  }

  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (error.message.toLowerCase().includes("auth session missing")) {
      throw createAuthRequiredError();
    }

    throw error;
  }

  if (!user) {
    throw createAuthRequiredError();
  }

  return user.id;
}

interface TrackerState extends AppDataSnapshot {
  trainingPlanList: TrainingPlanSummary[];
  userId: string | null;
  authMode: AuthMode;
  guestSnapshot: AppDataSnapshot | null;
  guestDataDirty: boolean;
  selectedWeek: number;
  selectedDay: number;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  setAuthMode: (mode: AuthMode) => void;
  ensureUserId: () => Promise<string>;
  markHydrated: () => void;
  setSelectedWeek: (weekNumber: number) => void;
  setSelectedDay: (dayNumber: number) => void;
  initializeForUser: (userId: string) => Promise<void>;
  initializeGuestSession: () => Promise<void>;
  hasGuestData: () => boolean;
  getGuestSnapshot: () => AppDataSnapshot | null;
  clearGuestData: () => void;
  clearUserData: () => void;
  refreshUserData: () => Promise<void>;
  updateSettings: (nextSettings: UserSettings) => Promise<void>;
  setTrainingPlan: (plan: TrainingPlan) => Promise<void>;
  setActivePlan: (planId: string) => Promise<void>;
  deleteTrainingPlan: (planId: string) => Promise<void>;
  addWorkoutLog: (workoutLog: Omit<WorkoutLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateWorkoutLog: (workoutLog: WorkoutLog) => Promise<void>;
  addFoodLog: (foodLog: Omit<FoodLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateFoodLog: (foodLog: Omit<FoodLog, "userId" | "createdAt">) => Promise<void>;
  deleteFoodLog: (id: string) => Promise<void>;
  addBodyMetricLog: (log: Omit<BodyMetricLog, "id" | "userId" | "createdAt"> & { id?: string }) => Promise<void>;
  updateBodyMetricLog: (log: BodyMetricLog) => Promise<void>;
  deleteBodyMetricLog: (id: string) => Promise<void>;
  resetAllData: () => Promise<void>;
  getSnapshot: () => AppDataSnapshot;
}

const defaultSnapshot = createEmptySnapshot("demo-user");
const defaultGuestSnapshot = createEmptySnapshot(GUEST_USER_ID);

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set, get) => ({
      ...defaultSnapshot,
      trainingPlanList: [],
      userId: null,
      authMode: "none",
      guestSnapshot: null,
      guestDataDirty: false,
      selectedWeek: 1,
      selectedDay: 1,
      hydrated: false,
      loading: false,
      error: null,
      setAuthMode: (mode) => set({ authMode: mode }),
      ensureUserId: async () => {
        if (isGuestMode(get())) {
          return GUEST_USER_ID;
        }

        const currentUserId = get().userId;
        const resolvedUserId = await resolveUserId(currentUserId);

        if (!currentUserId || currentUserId !== resolvedUserId) {
          set((state) => ({
            userId: resolvedUserId,
            settings: {
              ...state.settings,
              userId: resolvedUserId,
            },
          }));
        }

        return resolvedUserId;
      },
      markHydrated: () => set({ hydrated: true }),
      setSelectedWeek: (weekNumber) => set({ selectedWeek: weekNumber }),
      setSelectedDay: (dayNumber) => set({ selectedDay: dayNumber }),
      initializeForUser: async (userId) => {
        if (userId === GUEST_USER_ID || get().authMode === "guest") {
          await get().initializeGuestSession();
          return;
        }

        set({ loading: true, error: null, userId, authMode: "authenticated" });
        try {
          const bundle = await fetchUserDataBundle(userId);
          const previousWeek = get().selectedWeek;
          const previousDay = get().selectedDay;
          const matchedWeek = bundle.snapshot.trainingPlan.weeks.find((week) => week.weekNumber === previousWeek) ?? bundle.snapshot.trainingPlan.weeks[0];
          const matchedDay = matchedWeek?.days.find((day) => day.dayNumber === previousDay) ?? matchedWeek?.days[0];

          set((state) => ({
            ...bundle.snapshot,
            workoutLogs: sortWorkoutLogs(bundle.snapshot.workoutLogs),
            foodLogs: sortFoodLogs(bundle.snapshot.foodLogs),
            bodyMetricLogs: sortBodyLogs(bundle.snapshot.bodyMetricLogs),
            trainingPlanList: bundle.planList,
            selectedWeek: matchedWeek?.weekNumber ?? 1,
            selectedDay: matchedDay?.dayNumber ?? 1,
            loading: false,
            authMode: "authenticated",
            guestSnapshot: state.guestSnapshot,
          }));
        } catch (error) {
          console.error(error);
          set((state) => ({
            userId,
            authMode: "authenticated",
            error: error instanceof Error ? error.message : "Failed to load user data.",
            loading: false,
            settings:
              state.settings.userId === userId
                ? state.settings
                : {
                    ...state.settings,
                    userId,
                  },
          }));
        }
      },
      initializeGuestSession: async () => {
        set({ loading: true, error: null, authMode: "guest", userId: GUEST_USER_ID });
        try {
          const baseSnapshot = get().guestSnapshot
            ? normalizeSnapshotForUser(get().guestSnapshot as AppDataSnapshot, GUEST_USER_ID)
            : normalizeSnapshotForUser(defaultGuestSnapshot, GUEST_USER_ID);
          const previousWeek = get().selectedWeek;
          const previousDay = get().selectedDay;
          const matchedWeek = baseSnapshot.trainingPlan.weeks.find(
            (week) => week.weekNumber === previousWeek,
          ) ?? baseSnapshot.trainingPlan.weeks[0];
          const matchedDay = matchedWeek?.days.find((day) => day.dayNumber === previousDay) ?? matchedWeek?.days[0];

          set({
            ...baseSnapshot,
            workoutLogs: sortWorkoutLogs(baseSnapshot.workoutLogs),
            foodLogs: sortFoodLogs(baseSnapshot.foodLogs),
            bodyMetricLogs: sortBodyLogs(baseSnapshot.bodyMetricLogs),
            trainingPlanList: listFromPlan(baseSnapshot.trainingPlan),
            guestSnapshot: baseSnapshot,
            userId: GUEST_USER_ID,
            authMode: "guest",
            selectedWeek: matchedWeek?.weekNumber ?? 1,
            selectedDay: matchedDay?.dayNumber ?? 1,
            loading: false,
            error: null,
          });
        } catch (error) {
          console.error(error);
          set({
            userId: GUEST_USER_ID,
            authMode: "guest",
            error: error instanceof Error ? error.message : "Failed to initialize guest session.",
            loading: false,
          });
        }
      },
      hasGuestData: () => {
        const state = get();
        if (state.guestDataDirty) {
          return true;
        }

        return hasMeaningfulGuestData(state.guestSnapshot);
      },
      getGuestSnapshot: () => get().guestSnapshot,
      clearGuestData: () => {
        set({
          guestSnapshot: null,
          guestDataDirty: false,
        });
      },
      clearUserData: () => {
        set((state) => ({
          ...createEmptySnapshot("demo-user"),
          trainingPlanList: [],
          userId: null,
          authMode: "none",
          error: null,
          loading: false,
          selectedWeek: 1,
          selectedDay: 1,
          guestSnapshot: state.guestSnapshot,
          guestDataDirty: state.guestDataDirty,
        }));
      },
      refreshUserData: async () => {
        if (isGuestMode(get())) {
          await get().initializeGuestSession();
          return;
        }

        const resolvedUserId = await get().ensureUserId();
        await get().initializeForUser(resolvedUserId);
      },
      updateSettings: async (nextSettings) => {
        if (isGuestMode(get())) {
          const payload: UserSettings = {
            ...nextSettings,
            userId: GUEST_USER_ID,
            updatedAt: nowIso(),
          };

          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  settings: payload,
                }
              : normalizeSnapshotForUser(
                  {
                    settings: payload,
                    trainingPlan: state.trainingPlan,
                    workoutLogs: state.workoutLogs,
                    foodLogs: state.foodLogs,
                    bodyMetricLogs: state.bodyMetricLogs,
                    quickFoods: state.quickFoods,
                  },
                  GUEST_USER_ID,
                );

            return {
              settings: payload,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        const resolvedUserId = await get().ensureUserId();
        const previousSettings = get().settings;

        const payload: UserSettings = {
          ...nextSettings,
          userId: resolvedUserId,
          updatedAt: nowIso(),
        };

        set({ settings: payload });

        try {
          await upsertUserSettings(resolvedUserId, payload);
        } catch (error) {
          set({ settings: previousSettings });
          throw error;
        }
      },
      setTrainingPlan: async (plan) => {
        if (isGuestMode(get())) {
          const payload: TrainingPlan = {
            ...plan,
            userId: GUEST_USER_ID,
            notes: plan.notes || "",
            isActive: true,
            updatedAt: nowIso(),
            createdAt: plan.createdAt || nowIso(),
          };

          const firstWeek = payload.weeks[0];
          const firstDay = firstWeek?.days[0];
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  trainingPlan: payload,
                }
              : normalizeSnapshotForUser(
                  {
                    settings: state.settings,
                    trainingPlan: payload,
                    workoutLogs: state.workoutLogs,
                    foodLogs: state.foodLogs,
                    bodyMetricLogs: state.bodyMetricLogs,
                    quickFoods: state.quickFoods,
                  },
                  GUEST_USER_ID,
                );
            return {
              trainingPlan: payload,
              trainingPlanList: listFromPlan(payload),
              selectedWeek: firstWeek?.weekNumber ?? 1,
              selectedDay: firstDay?.dayNumber ?? 1,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        const resolvedUserId = await get().ensureUserId();
        const previousPlan = get().trainingPlan;
        const previousList = get().trainingPlanList;

        const payload: TrainingPlan = {
          ...plan,
          userId: resolvedUserId,
          notes: plan.notes || "",
          isActive: true,
          updatedAt: nowIso(),
          createdAt: plan.createdAt || nowIso(),
        };

        const firstWeek = payload.weeks[0];
        const firstDay = firstWeek?.days[0];

        set({
          trainingPlan: payload,
          trainingPlanList: upsertSummaryList(previousList, toTrainingPlanSummary(payload), { setActive: true }),
          selectedWeek: firstWeek?.weekNumber ?? 1,
          selectedDay: firstDay?.dayNumber ?? 1,
        });

        try {
          await saveTrainingPlan(resolvedUserId, payload);
        } catch (error) {
          set({
            trainingPlan: previousPlan,
            trainingPlanList: previousList,
          });
          throw error;
        }
      },
      setActivePlan: async (planId) => {
        if (isGuestMode(get())) {
          const currentPlan = get().trainingPlan;
          if (currentPlan.id !== planId) {
            throw new Error("Guest mode currently supports a single active training plan.");
          }

          set((state) => ({
            trainingPlanList: state.trainingPlanList.map((item) => ({
              ...item,
              isActive: item.id === planId,
            })),
          }));
          return;
        }

        const resolvedUserId = await get().ensureUserId();
        const previousList = get().trainingPlanList;

        set({
          trainingPlanList: previousList.map((item) => ({
            ...item,
            isActive: item.id === planId,
          })),
        });

        try {
          await setActiveTrainingPlan(resolvedUserId, planId);
          if (get().trainingPlan.id !== planId) {
            await get().initializeForUser(resolvedUserId);
          }
        } catch (error) {
          set({ trainingPlanList: previousList });
          throw error;
        }
      },
      deleteTrainingPlan: async (planId) => {
        if (isGuestMode(get())) {
          const currentPlan = get().trainingPlan;
          if (currentPlan.id !== planId) {
            throw new Error("Training plan not found or already deleted.");
          }

          const emptyPlan = createEmptyTrainingPlan(GUEST_USER_ID);
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  trainingPlan: emptyPlan,
                }
              : normalizeSnapshotForUser(
                  {
                    settings: state.settings,
                    trainingPlan: emptyPlan,
                    workoutLogs: state.workoutLogs,
                    foodLogs: state.foodLogs,
                    bodyMetricLogs: state.bodyMetricLogs,
                    quickFoods: state.quickFoods,
                  },
                  GUEST_USER_ID,
                );

            return {
              trainingPlan: emptyPlan,
              trainingPlanList: [],
              selectedWeek: 1,
              selectedDay: 1,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        const resolvedUserId = await get().ensureUserId();
        const previousPlan = get().trainingPlan;
        const previousList = get().trainingPlanList;
        const previousWeek = get().selectedWeek;
        const previousDay = get().selectedDay;
        const nextList = previousList.filter((item) => item.id !== planId);

        set({ trainingPlanList: nextList });

        try {
          const result = await removeTrainingPlan(resolvedUserId, planId);

          if (!result.nextActivePlanId) {
            set({
              trainingPlan: createEmptyTrainingPlan(resolvedUserId),
              trainingPlanList: [],
              selectedWeek: 1,
              selectedDay: 1,
            });
            return;
          }

          if (previousPlan.id === planId || previousPlan.id !== result.nextActivePlanId) {
            await get().initializeForUser(resolvedUserId);
            return;
          }

          set((state) => ({
            trainingPlanList: state.trainingPlanList.map((item) => ({
              ...item,
              isActive: item.id === result.nextActivePlanId,
            })),
          }));
        } catch (error) {
          set({
            trainingPlan: previousPlan,
            trainingPlanList: previousList,
            selectedWeek: previousWeek,
            selectedDay: previousDay,
          });
          throw error;
        }
      },
      addWorkoutLog: async (workoutLog) => {
        const { trainingPlan, workoutLogs } = get();
        const resolvedUserId = await get().ensureUserId();

        const workoutLogId = workoutLog.id ?? safeRandomId("workout");
        const payload: WorkoutLog = {
          id: workoutLogId,
          userId: resolvedUserId,
          date: workoutLog.date,
          trainingPlanId: workoutLog.trainingPlanId || trainingPlan.id,
          weekNumber: workoutLog.weekNumber,
          dayNumber: workoutLog.dayNumber,
          durationMinutes: workoutLog.durationMinutes,
          completed: workoutLog.completed,
          notes: workoutLog.notes,
          createdAt: nowIso(),
          exercises: workoutLog.exercises.map((exercise, index) => ({
            id: exercise.id || `${workoutLogId}-ex-${index + 1}`,
            workoutLogId,
            exercisePlanId: exercise.exercisePlanId,
            name: exercise.name,
            actualWeight: exercise.actualWeight,
            actualReps: exercise.actualReps,
            actualRpe: exercise.actualRpe,
            completed: exercise.completed,
          })),
        };

        const nextLogs = sortWorkoutLogs([
          payload,
          ...workoutLogs.filter((item) => item.id !== payload.id),
        ]);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  workoutLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  workoutLogs: nextLogs,
                } as TrackerState);
            return {
              workoutLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({ workoutLogs: nextLogs });

        try {
          await upsertWorkoutLog(resolvedUserId, payload);
        } catch (error) {
          set({ workoutLogs });
          throw error;
        }
      },
      updateWorkoutLog: async (workoutLog) => {
        await get().addWorkoutLog(workoutLog);
      },
      addFoodLog: async (foodLog) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;

        const payload: FoodLog = {
          id: foodLog.id ?? safeRandomId("food"),
          userId: resolvedUserId,
          date: foodLog.date,
          mealType: foodLog.mealType,
          foodName: foodLog.foodName,
          calories: foodLog.calories,
          protein: foodLog.protein,
          createdAt: nowIso(),
        };

        const nextLogs = sortFoodLogs([
          payload,
          ...previousLogs.filter((item) => item.id !== payload.id),
        ]);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  foodLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  foodLogs: nextLogs,
                } as TrackerState);
            return {
              foodLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({
          foodLogs: nextLogs,
        });

        try {
          await upsertFoodLog(resolvedUserId, payload);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      updateFoodLog: async (foodLog) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;
        const existing = previousLogs.find((item) => item.id === foodLog.id);

        const payload: FoodLog = {
          id: foodLog.id,
          userId: resolvedUserId,
          date: foodLog.date,
          mealType: foodLog.mealType,
          foodName: foodLog.foodName,
          calories: foodLog.calories,
          protein: foodLog.protein,
          createdAt: existing?.createdAt ?? nowIso(),
        };

        const nextLogs = sortFoodLogs([
          payload,
          ...previousLogs.filter((item) => item.id !== payload.id),
        ]);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  foodLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  foodLogs: nextLogs,
                } as TrackerState);
            return {
              foodLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({
          foodLogs: nextLogs,
        });

        try {
          await upsertFoodLog(resolvedUserId, payload);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      deleteFoodLog: async (id) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().foodLogs;
        const nextLogs = previousLogs.filter((item) => item.id !== id);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  foodLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  foodLogs: nextLogs,
                } as TrackerState);
            return {
              foodLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({ foodLogs: nextLogs });

        try {
          await removeFoodLog(resolvedUserId, id);
        } catch (error) {
          set({ foodLogs: previousLogs });
          throw error;
        }
      },
      addBodyMetricLog: async (log) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().bodyMetricLogs;

        const payload: BodyMetricLog = {
          id: log.id ?? safeRandomId("body"),
          userId: resolvedUserId,
          date: log.date,
          weight: log.weight,
          waist: log.waist,
          notes: log.notes ?? "",
          createdAt: nowIso(),
        };

        const nextLogs = sortBodyLogs([
          payload,
          ...previousLogs.filter((item) => item.id !== payload.id),
        ]);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  bodyMetricLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  bodyMetricLogs: nextLogs,
                } as TrackerState);
            return {
              bodyMetricLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({
          bodyMetricLogs: nextLogs,
        });

        try {
          await upsertBodyMetricLog(resolvedUserId, payload);
        } catch (error) {
          set({ bodyMetricLogs: previousLogs });
          throw error;
        }
      },
      updateBodyMetricLog: async (log) => {
        await get().addBodyMetricLog(log);
      },
      deleteBodyMetricLog: async (id) => {
        const resolvedUserId = await get().ensureUserId();
        const previousLogs = get().bodyMetricLogs;
        const nextLogs = previousLogs.filter((item) => item.id !== id);

        if (isGuestMode(get())) {
          set((state) => {
            const nextSnapshot = state.guestSnapshot
              ? {
                  ...state.guestSnapshot,
                  bodyMetricLogs: nextLogs,
                }
              : createGuestSnapshotFromState({
                  ...state,
                  bodyMetricLogs: nextLogs,
                } as TrackerState);
            return {
              bodyMetricLogs: nextLogs,
              guestSnapshot: nextSnapshot,
              guestDataDirty: true,
            };
          });
          return;
        }

        set({ bodyMetricLogs: nextLogs });

        try {
          await removeBodyMetricLog(resolvedUserId, id);
        } catch (error) {
          set({ bodyMetricLogs: previousLogs });
          throw error;
        }
      },
      resetAllData: async () => {
        if (isGuestMode(get())) {
          const snapshot = normalizeSnapshotForUser(createEmptySnapshot(GUEST_USER_ID), GUEST_USER_ID);
          set({
            ...snapshot,
            workoutLogs: sortWorkoutLogs(snapshot.workoutLogs),
            foodLogs: sortFoodLogs(snapshot.foodLogs),
            bodyMetricLogs: sortBodyLogs(snapshot.bodyMetricLogs),
            trainingPlanList: listFromPlan(snapshot.trainingPlan),
            guestSnapshot: snapshot,
            guestDataDirty: true,
            selectedWeek: 1,
            selectedDay: 1,
            loading: false,
            error: null,
          });
          return;
        }

        const resolvedUserId = await get().ensureUserId();

        const snapshot = createEmptySnapshot(resolvedUserId);
        await upsertUserSettings(resolvedUserId, snapshot.settings);
        await saveTrainingPlan(resolvedUserId, snapshot.trainingPlan);
        await get().refreshUserData();
      },
      getSnapshot: () => {
        const state = get();
        return {
          settings: state.settings,
          trainingPlan: state.trainingPlan,
          workoutLogs: state.workoutLogs,
          foodLogs: state.foodLogs,
          bodyMetricLogs: state.bodyMetricLogs,
          quickFoods: state.quickFoods,
        };
      },
    }),
    {
      name: "liftcut-tracker-ui-state",
      storage: typeof window !== "undefined" ? createJSONStorage(() => localStorage) : undefined,
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
      partialize: (state) => ({
        selectedWeek: state.selectedWeek,
        selectedDay: state.selectedDay,
        guestSnapshot: state.guestSnapshot,
        guestDataDirty: state.guestDataDirty,
      }),
    },
  ),
);
