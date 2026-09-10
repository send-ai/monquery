import { FieldType, QueryConfig, getField, sortableKeys } from "./config";
import { MonqueryError } from "./errors";

export interface SortSpec {
  key: string;
  path: string;
  type: FieldType;
  direction: 1 | -1;
}

export const DEFAULT_SORT: SortSpec = { key: "_id", path: "_id", type: "string", direction: 1 };

/** Parses `sort=<key> [asc|desc]`. Defaults to `_id asc`, matching v1. */
export function parseSort(raw: string | undefined | null, config: QueryConfig): SortSpec {
  if (raw == null || raw.trim() === "") return DEFAULT_SORT;

  const parts = raw.trim().split(/\s+/);
  if (parts.length > 2) throw new MonqueryError("invalid_sort", `Sort must be '<key> asc' or '<key> desc', got '${raw}'`);

  const [key, order = "asc"] = parts;
  const field = getField(config, key);
  if (!field || !field.sort) {
    throw new MonqueryError("invalid_sort", 
      `Sort key '${key}' is invalid for this route, use one of: ${sortableKeys(config).join(", ")}`
    );
  }

  const normalized = order.toLowerCase();
  if (normalized !== "asc" && normalized !== "desc") {
    throw new MonqueryError("invalid_sort", `Sort order should either be 'asc' or 'desc', got '${order}'`);
  }

  return { key, path: field.path, type: field.type, direction: normalized === "desc" ? -1 : 1 };
}

/** The `$sort` stage for a spec. `_id` is always the tiebreaker so the order is total. */
export function sortStage(sort: SortSpec): Record<string, 1 | -1> {
  if (sort.path === "_id") return { _id: sort.direction };
  return { [sort.path]: sort.direction, _id: sort.direction };
}
