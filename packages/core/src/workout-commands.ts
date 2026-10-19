import { z } from "zod";
import type { StoredSet } from "./today";
import type { LogDraft, ParseResult } from "./workout-log-parser";

export const parseLogSchema = z.object({ sessionId: z.uuid(), text: z.string().trim().min(1).max(400),
  selectedExerciseId: z.string().min(1).max(150).optional() }).strict();
export const commandSchema = parseLogSchema.extend({ id: z.uuid(), version: z.literal(1),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/), setIds: z.array(z.uuid()).max(16),
  authorization: z.literal("confirm_preview"),
  modelProof:z.string().max(24000).optional(), originalText:z.string().min(1).max(400).optional(),
}).strict().refine(r => new Set(r.setIds).size === r.setIds.length, "Duplicate set UUID")
  .refine(r=>!!r.modelProof===!!r.originalText,"Model proposal/source pair required");
export const undoCommandSchema = z.object({ id: z.uuid(), commandId: z.uuid(), version: z.literal(1) }).strict();
export type CommandRequest = z.infer<typeof commandSchema>;
export type ParsePreview = { result: ParseResult; contextHash: string; parser: "rules-v1" };
export type SetChange = { before: StoredSet | null; after: StoredSet; exerciseName: string };
export type CommandReceipt = { id: string; sessionId: string; text: string;
  draft: Exclude<LogDraft, { kind: "end" }>; changes: SetChange[]; createdAt: string;
  model?:{provider:string;model:string;sourceTexts:string[];version:"coach-v1"};
  undo: null | { id: string; createdAt: string; changes: SetChange[] } };
