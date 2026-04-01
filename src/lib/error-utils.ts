export const AUTH_REQUIRED_ERROR_CODE = "AUTH_REQUIRED";

export function createAuthRequiredError(): Error {
  const error = new Error(AUTH_REQUIRED_ERROR_CODE);
  error.name = AUTH_REQUIRED_ERROR_CODE;
  return error;
}

export function isAuthRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === AUTH_REQUIRED_ERROR_CODE ||
    error.name === AUTH_REQUIRED_ERROR_CODE ||
    error.message.toLowerCase().includes("auth session missing")
  );
}

export function normalizeActionError(
  error: unknown,
  options: {
    fallback: string;
    authMessage?: string;
  },
): string {
  if (isAuthRequiredError(error)) {
    return options.authMessage ?? options.fallback;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return options.fallback;
}
