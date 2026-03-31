import { parsedPlanSchema } from "@/lib/plan-import-schema";
import { normalizeParsedPlanToTrainingPlan } from "@/lib/plan-normalizer";
import { parsePlanText } from "@/lib/plan-parser";
import type { ParsedLineError, TrainingPlan } from "@/types";

export interface PlanImportOutput {
  plan: TrainingPlan | null;
  warnings: string[];
  errors: ParsedLineError[];
}

export interface PlanImportService {
  parseFromText(input: string, params: { userId: string; planName?: string }): PlanImportOutput;
}

class RuleBasedPlanImportService implements PlanImportService {
  parseFromText(input: string, params: { userId: string; planName?: string }): PlanImportOutput {
    const parsedResult = parsePlanText(input, params.planName || "Imported Text Plan");

    if (!parsedResult.draft) {
      return {
        plan: null,
        warnings: parsedResult.warnings,
        errors: parsedResult.errors,
      };
    }

    const schemaResult = parsedPlanSchema.safeParse(parsedResult.draft);
    if (!schemaResult.success) {
      return {
        plan: null,
        warnings: parsedResult.warnings,
        errors: [
          {
            lineNumber: 0,
            content: "",
            reason: schemaResult.error.issues[0]?.message || "Invalid parsed structure",
          },
        ],
      };
    }

    const plan = normalizeParsedPlanToTrainingPlan(schemaResult.data, {
      userId: params.userId,
      name: params.planName,
    });

    return {
      plan,
      warnings: parsedResult.warnings,
      errors: parsedResult.errors,
    };
  }
}

export const planImportService: PlanImportService = new RuleBasedPlanImportService();