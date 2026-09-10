export type MonqueryErrorCode =
  | "syntax"
  | "unknown_field"
  | "operator_not_allowed"
  | "invalid_value"
  | "invalid_sort"
  | "invalid_limit"
  | "invalid_token"
  | "invalid_query"
  | "unsupported";

/**
 * Every user-facing query error. `status` is 400 so HTTP layers can map it without knowing the codes;
 * `position` is the character offset in the filter string when known.
 */
export class MonqueryError extends Error {
  readonly name = "MonqueryError";
  readonly status = 400;
  readonly code: MonqueryErrorCode;
  readonly position?: number;

  constructor(code: MonqueryErrorCode, message: string, position?: number) {
    super(position === undefined ? message : `${message} (at position ${position})`);
    this.code = code;
    this.position = position;
  }
}

export function isMonqueryError(value: unknown): value is MonqueryError {
  return value instanceof MonqueryError || (typeof value === "object" && value !== null && (value as { name?: string }).name === "MonqueryError");
}
