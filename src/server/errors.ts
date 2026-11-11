export type ErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "payload_too_large"
  | "provider_unavailable"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  validation_error: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  payload_too_large: 413,
  provider_unavailable: 503,
  internal_error: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} was not found.`);
export const forbidden = (message = "You do not have permission to do this.") => new AppError("forbidden", message);
export const conflict = (message: string, details?: Record<string, unknown>) => new AppError("conflict", message, undefined, details);
export const precondition = (message: string) => new AppError("precondition_failed", message);
