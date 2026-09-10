import { QueryConfig } from "./config";
import { MonqueryError } from "./errors";

/** Parses `limit=<n>`. Defaults to the route maximum; anything outside `1..max` is rejected. */
export function parseLimit(raw: string | undefined | null, config: QueryConfig): number {
  if (raw == null || raw.trim() === "") return config.limit;

  const value = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > config.limit) {
    throw new MonqueryError("invalid_limit", `Limit must be a whole number between 1 and ${config.limit}, got '${raw}'`);
  }
  return value;
}
