/**
 * Builders for filter strings. Values are quoted and escaped here so no caller concatenates user input.
 * Clauses are plain `{ kind, text }` objects; `text` is the filter syntax.
 */
export type ClauseKind = "cmp" | "and" | "or" | "not";

export interface Clause {
  readonly kind: ClauseKind;
  readonly text: string;
}

export type Scalar = string | number | boolean | Date | null;

export type MaybeClause = Clause | null | undefined | false;

/** Quotes a string for the filter grammar; a quote inside the value is doubled. */
export const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const literal = (value: Scalar): string => {
  if (value === null) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return quote(value);
  return String(value);
};

const cmp = (key: string, op: string, value: Scalar): Clause => ({ kind: "cmp", text: `${key} ${op} ${literal(value)}` });

const list = (key: string, op: string, values: readonly Scalar[]): Clause => ({
  kind: "cmp",
  text: `${key} ${op} ${values.map(literal).join(",")}`,
});

const present = (clauses: readonly MaybeClause[]): Clause[] => clauses.filter((c): c is Clause => !!c);

const paren = (clause: Clause, kinds: readonly ClauseKind[]): string =>
  kinds.includes(clause.kind) ? `(${clause.text})` : clause.text;

/** Wraps an existing filter string as a clause. It is bracketed when combined, so its precedence is preserved. */
export const raw = (text: string): Clause | null => (text.trim() ? { kind: "or", text: text.trim() } : null);

export const f = {
  eq: (key: string, value: Scalar): Clause => cmp(key, "eq", value),
  ne: (key: string, value: Scalar): Clause => cmp(key, "ne", value),
  lt: (key: string, value: Scalar): Clause => cmp(key, "lt", value),
  lte: (key: string, value: Scalar): Clause => cmp(key, "lte", value),
  gt: (key: string, value: Scalar): Clause => cmp(key, "gt", value),
  gte: (key: string, value: Scalar): Clause => cmp(key, "gte", value),
  in: (key: string, values: readonly Scalar[]): Clause => list(key, "in", values),
  nin: (key: string, values: readonly Scalar[]): Clause => list(key, "nin", values),
  all: (key: string, values: readonly Scalar[]): Clause => list(key, "all", values),
  /** Raw pattern, applied case-insensitively by the server. Prefer `contains` for user text. */
  regex: (key: string, pattern: string): Clause => cmp(key, "regex", pattern),
  contains: (key: string, text: string): Clause => cmp(key, "contains", text),
  startswith: (key: string, text: string): Clause => cmp(key, "startswith", text),
  endswith: (key: string, text: string): Clause => cmp(key, "endswith", text),
  exists: (key: string, value: boolean): Clause => cmp(key, "exists", value),
  isNull: (key: string): Clause => cmp(key, "eq", null),
  isNotNull: (key: string): Clause => cmp(key, "ne", null),

  /** Skips falsy entries so conditional clauses can be passed inline. Null when nothing remains. */
  and: (...clauses: MaybeClause[]): Clause | null => {
    const items = present(clauses);
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];
    return { kind: "and", text: items.map((c) => paren(c, ["or"])).join(" and ") };
  },

  or: (...clauses: MaybeClause[]): Clause | null => {
    const items = present(clauses);
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];
    return { kind: "or", text: items.map((c) => c.text).join(" or ") };
  },

  not: (clause: Clause): Clause => ({ kind: "not", text: `not ${paren(clause, ["and", "or"])}` }),

  /** `gt from and lt to`, either side optional. Null when both are missing. */
  between: (key: string, range: { from?: Date | string | null; to?: Date | string | null }): Clause | null =>
    f.and(range.from ? cmp(key, "gt", range.from) : null, range.to ? cmp(key, "lt", range.to) : null),

  /** `gt <epoch>` when set, `eq null` when unset: the usual "has this happened" idiom for nullable dates. */
  isSet: (key: string, set: boolean): Clause => (set ? cmp(key, "gt", new Date(0)) : cmp(key, "eq", null)),
};

export const toFilterString = (clause: Clause | null | undefined): string | undefined => clause?.text || undefined;
