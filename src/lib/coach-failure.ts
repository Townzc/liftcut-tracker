// Stable public codes only; SDK messages may contain prompts or provider keys.
export function coachFailureCode(error:unknown):"MODEL_TIMEOUT"|"MODEL_OUTPUT_LIMIT"|"MODEL_UNAVAILABLE"{
  if(error instanceof Error&&error.name==="TimeoutError")return "MODEL_TIMEOUT";
  if(error instanceof Error&&error.message==="MODEL_OUTPUT_LIMIT")return "MODEL_OUTPUT_LIMIT";
  return "MODEL_UNAVAILABLE";
}

// A progressing plan must not be killed by the old 22-second step deadline.
// Stalled output still stops promptly, within the unchanged overall budget.
export const COACH_MODEL_TIMEOUT={totalMs:45000,firstChunkMs:12000,chunkMs:10000,toolMs:12000} as const;
