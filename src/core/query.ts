import { FilterNode } from "./ast";
import { CheckedFilter, checkFilter } from "./check";
import { QueryConfig } from "./config";
import { MonqueryError } from "./errors";
import { parseLimit } from "./limit";
import { parseFilter } from "./parser";
import { SortSpec, parseSort } from "./sort";

/** The five query parameters every monquery endpoint accepts, as they arrive (strings or absent). */
export interface RawQuery {
  q?: string;
  token?: string;
  limit?: string;
  sort?: string;
  filter?: string;
}

/** Result of parsing and checking a query against a config. Database-free; adapters build on it. */
export interface ParsedQuery {
  ast: FilterNode | null;
  filter: CheckedFilter | null;
  sort: SortSpec;
  limit: number;
  q: string | null;
  token: string | null;
}

const PARAMS = ["q", "token", "limit", "sort", "filter"] as const;

/** Accepts `URLSearchParams`, a plain object (e.g. Express `req.query`) or a query string. Extra keys are ignored. */
export function toRawQuery(input: unknown): RawQuery {
  const source: Record<string, unknown> =
    typeof input === "string"
      ? Object.fromEntries(new URLSearchParams(input))
      : input instanceof URLSearchParams
        ? Object.fromEntries(input)
        : ((input ?? {}) as Record<string, unknown>);

  const raw: RawQuery = {};
  for (const name of PARAMS) {
    const value = source[name];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new MonqueryError("invalid_query", `Query parameter '${name}' must be a single string`);
    }
    raw[name] = value;
  }
  return raw;
}

/** Parses `filter`, `sort`, `limit`, `q` and `token` and validates the filter against the config. */
export function parseQuery(input: unknown, config: QueryConfig): ParsedQuery {
  const raw = toRawQuery(input);
  const ast = parseFilter(raw.filter);
  const filter = checkFilter(ast, config);
  const sort = parseSort(raw.sort, config);
  const limit = parseLimit(raw.limit, config);
  const q = raw.q?.trim() ? raw.q : null;
  const token = raw.token?.trim() ? raw.token : null;
  return { ast, filter, sort, limit, q, token };
}

/** Like `parseQuery` but returns the error instead of throwing. Handy for live validation in a UI. */
export function validateQuery(
  input: unknown,
  config: QueryConfig
): { ok: true; query: ParsedQuery } | { ok: false; error: MonqueryError } {
  try {
    return { ok: true, query: parseQuery(input, config) };
  } catch (error) {
    if (error instanceof MonqueryError) return { ok: false, error };
    throw error;
  }
}
