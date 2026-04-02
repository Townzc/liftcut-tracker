import type { Gender, UserSettings } from "@/types";

export interface BasicProfileFields {
  gender?: Gender | null;
  age?: number | null;
  height?: number | null;
  currentWeight?: number | null;
  targetWeight?: number | null;
  weeklyTrainingDays?: number | null;
}

function toPositiveNumber(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

export function isGenderConfigured(gender: Gender | null | undefined): boolean {
  return Boolean(gender && gender !== "unknown");
}

export function isBasicProfileComplete(settings: BasicProfileFields | null | undefined): boolean {
  if (!settings) {
    return false;
  }

  return (
    isGenderConfigured(settings.gender) &&
    toPositiveNumber(settings.age) > 0 &&
    toPositiveNumber(settings.height) > 0 &&
    toPositiveNumber(settings.currentWeight) > 0 &&
    toPositiveNumber(settings.targetWeight) > 0 &&
    toPositiveNumber(settings.weeklyTrainingDays) > 0
  );
}

export function toBasicProfileFieldsFromSettings(settings: UserSettings): BasicProfileFields {
  return {
    gender: settings.gender,
    age: settings.age,
    height: settings.height,
    currentWeight: settings.currentWeight,
    targetWeight: settings.targetWeight,
    weeklyTrainingDays: settings.weeklyTrainingDays,
  };
}
