export type AiErrorCode =
  | "AI_CONFIG_MISSING"
  | "AI_REQUEST_FAILED"
  | "AI_EMPTY_RESPONSE"
  | "AI_INVALID_JSON"
  | "AI_SCHEMA_VALIDATION_FAILED"
  | "AI_PROFILE_INCOMPLETE"
  | "AI_LANGUAGE_MISMATCH";

const STATUS_BY_CODE: Record<AiErrorCode, number> = {
  AI_CONFIG_MISSING: 503,
  AI_REQUEST_FAILED: 502,
  AI_EMPTY_RESPONSE: 502,
  AI_INVALID_JSON: 502,
  AI_SCHEMA_VALIDATION_FAILED: 422,
  AI_PROFILE_INCOMPLETE: 400,
  AI_LANGUAGE_MISMATCH: 422,
};

export class AiServiceError extends Error {
  code: AiErrorCode;
  status: number;
  detail?: string;

  constructor(code: AiErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

export function normalizeAiError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) {
    return error;
  }

  if (error instanceof Error) {
    return new AiServiceError("AI_REQUEST_FAILED", "AI service request failed.", error.message);
  }

  return new AiServiceError("AI_REQUEST_FAILED", "AI service request failed.");
}
