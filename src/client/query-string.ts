import { Clause, toFilterString } from "./builder";

export interface MonquerySort {
  key: string;
  direction: "asc" | "desc";
}

export interface MonqueryParams {
  filter?: Clause | string | null;
  q?: string | null;
  sort?: MonquerySort | string | null;
  limit?: number | null;
  token?: string | null;
}

/** Drops empty, whitespace-only and `""` searches, which search boxes produce. */
export const normalizeSearchQuery = (q: string | undefined | null): string | undefined => {
  if (q == null) return undefined;
  const trimmed = q.trim();
  if (trimmed.length === 0) return undefined;
  if (/^"\s*"$/.test(trimmed)) return undefined;
  return q;
};

export const serializeSort = (sort: MonquerySort | string): string =>
  typeof sort === "string" ? sort : `${sort.key} ${sort.direction}`;

/** Builds `URLSearchParams` with `limit`, `sort`, `q`, `filter`, `token` in that stable order, omitting absent ones. */
export const buildSearchParams = ({ filter, q, sort, limit, token }: MonqueryParams): URLSearchParams => {
  const params = new URLSearchParams();
  if (limit != null) params.append("limit", String(limit));
  if (sort) params.append("sort", serializeSort(sort));
  const search = normalizeSearchQuery(q);
  if (search !== undefined) params.append("q", search);
  const filterText = typeof filter === "string" ? filter || undefined : toFilterString(filter);
  if (filterText) params.append("filter", filterText);
  if (token) params.append("token", token);
  return params;
};

/** `buildSearchParams` as a string, ready to append after `?`. */
export const buildQueryString = (params: MonqueryParams): string => buildSearchParams(params).toString();
