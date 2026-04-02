export const AUTH_REQUIRED_ERROR_CODE = "AUTH_REQUIRED";
const PROFILE_SCHEMA_ERROR_CODES = new Set(["42703", "PGRST204"]);
const PROFILE_SCHEMA_COLUMNS = ["display_name", "avatar_url"];

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorLike(error: unknown): ErrorLike | null {
  if (error instanceof Error) {
    return error as Error & ErrorLike;
  }
  if (isRecord(error)) {
    return error;
  }
  return null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorCode(error: unknown): string {
  const candidate = toErrorLike(error);
  return readString(candidate?.code).toUpperCase();
}

function getErrorText(error: unknown): string {
  const candidate = toErrorLike(error);
  if (!candidate) {
    return "";
  }
  return [candidate.message, candidate.details, candidate.hint]
    .map((part) => readString(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isProfileSchemaMissingError(error: unknown): boolean {
  const errorText = getErrorText(error);
  const errorCode = getErrorCode(error);
  const mentionsProfileColumn = PROFILE_SCHEMA_COLUMNS.some((column) => errorText.includes(column));
  const mentionsMissingSchema =
    errorText.includes("schema cache") ||
    errorText.includes("does not exist") ||
    errorText.includes("not found") ||
    errorText.includes("missing column") ||
    errorText.includes("column");

  if (PROFILE_SCHEMA_ERROR_CODES.has(errorCode) && mentionsProfileColumn) {
    return true;
  }

  return errorText.includes("profiles") && mentionsProfileColumn && mentionsMissingSchema;
}

export function createAuthRequiredError(): Error {
  const error = new Error(AUTH_REQUIRED_ERROR_CODE);
  error.name = AUTH_REQUIRED_ERROR_CODE;
  return error;
}

export function isAuthRequiredError(error: unknown): boolean {
  const candidate = toErrorLike(error);
  if (!candidate) {
    return false;
  }
  const messageRaw = readString(candidate.message);
  const message = messageRaw.toLowerCase();
  const name = readString(candidate.name);
  return (
    messageRaw === AUTH_REQUIRED_ERROR_CODE ||
    name === AUTH_REQUIRED_ERROR_CODE ||
    message.includes("auth session missing")
  );
}

export function normalizeActionError(
  error: unknown,
  options: {
    fallback: string;
    authMessage?: string;
    schemaMessage?: string;
  },
): string {
  if (options.schemaMessage && isProfileSchemaMissingError(error)) {
    return options.schemaMessage;
  }

  if (isAuthRequiredError(error)) {
    return options.authMessage ?? options.fallback;
  }

  const candidate = toErrorLike(error);
  const message = readString(candidate?.message);
  if (message) {
    return message;
  }

  return options.fallback;
}
