import { Comparison, FilterNode, Literal } from "./ast";
import { FieldConfig, FieldType, QueryConfig, filterableKeys, getField } from "./config";
import { MonqueryError } from "./errors";

export type TypedValue = string | number | boolean | Date | null;

/** A comparison that passed the config: key resolved to a path, operator allowed, values coerced. */
export type CheckedComparison = { type: "cmp"; key: string; path: string; op: string; fieldType: FieldType } & (
  | { kind: "value"; value: TypedValue }
  | { kind: "list"; values: TypedValue[] }
  | { kind: "pattern"; pattern: string }
  | { kind: "patterns"; patterns: string[] }
  | { kind: "exists"; value: boolean }
);

export type CheckedFilter =
  | { type: "and"; nodes: CheckedFilter[] }
  | { type: "or"; nodes: CheckedFilter[] }
  | { type: "not"; node: CheckedFilter }
  | CheckedComparison;

const LIST_OPERATORS = new Set(["in", "nin", "all", "inregex", "ninregex"]);
const NULLABLE_OPERATORS = new Set(["eq", "ne", "in", "nin"]);

export const OPERATORS: Record<FieldType, readonly string[]> = {
  string: ["eq", "ne", "in", "nin", "all", "regex", "inregex", "ninregex", "contains", "startswith", "endswith", "exists"],
  number: ["eq", "ne", "lt", "lte", "gt", "gte", "in", "nin", "all", "exists"],
  date: ["eq", "ne", "lt", "lte", "gt", "gte", "in", "nin", "exists"],
  boolean: ["eq", "ne", "exists"],
};

export const MAX_REGEX_LENGTH = 512;

/**
 * Validates a parsed filter against a config and coerces every value to its field type.
 * Runs anywhere (no database code), so a client can produce the same errors as the server.
 */
export function checkFilter(node: FilterNode | null, config: QueryConfig): CheckedFilter | null {
  if (!node) return null;
  return checkNode(node, config);
}

function checkNode(node: FilterNode, config: QueryConfig): CheckedFilter {
  switch (node.type) {
    case "and":
      return { type: "and", nodes: node.nodes.map((n) => checkNode(n, config)) };
    case "or":
      return { type: "or", nodes: node.nodes.map((n) => checkNode(n, config)) };
    case "not":
      return { type: "not", node: checkNode(node.node, config) };
    case "cmp":
      return checkComparison(node, config);
  }
}

function checkComparison(cmp: Comparison, config: QueryConfig): CheckedComparison {
  const field = getField(config, cmp.key);
  if (!field || !field.filter) {
    throw new MonqueryError(
      "unknown_field",
      `You are not allowed to filter on '${cmp.key}', use one of: ${filterableKeys(config).join(", ")}`,
      cmp.position
    );
  }

  const allowed = OPERATORS[field.type];
  if (!allowed.includes(cmp.op)) {
    throw new MonqueryError(
      "operator_not_allowed",
      `Operator '${cmp.op}' is not allowed for '${cmp.key}' (${field.type}), use one of: ${allowed.join(", ")}`,
      cmp.position
    );
  }

  const base = { type: "cmp" as const, key: cmp.key, path: field.path, op: cmp.op, fieldType: field.type };
  const isList = LIST_OPERATORS.has(cmp.op);

  if (!isList && cmp.values.length !== 1) {
    const problem = cmp.values.length === 0 ? "requires a value" : "accepts a single value";
    throw new MonqueryError("invalid_value", `Operator '${cmp.op}' on '${cmp.key}' ${problem}`, cmp.position);
  }

  switch (cmp.op) {
    case "exists":
      return { ...base, kind: "exists", value: coerceBoolean(cmp.values[0], cmp) };
    case "regex":
      return { ...base, kind: "pattern", pattern: validRegex(cmp.values[0].raw, cmp) };
    case "inregex":
    case "ninregex":
      return { ...base, kind: "patterns", patterns: cmp.values.map((v) => validRegex(v.raw, cmp)) };
    case "contains":
      return { ...base, kind: "pattern", pattern: escapeRegex(cmp.values[0].raw) };
    case "startswith":
      return { ...base, kind: "pattern", pattern: `^${escapeRegex(cmp.values[0].raw)}` };
    case "endswith":
      return { ...base, kind: "pattern", pattern: `${escapeRegex(cmp.values[0].raw)}$` };
    case "in":
    case "nin":
    case "all":
      return { ...base, kind: "list", values: cmp.values.map((v) => coerce(v, field, cmp)) };
    default:
      return { ...base, kind: "value", value: coerce(cmp.values[0], field, cmp) };
  }
}

function coerce(literal: Literal, field: FieldConfig, cmp: Comparison): TypedValue {
  if (!literal.quoted && literal.raw.toLowerCase() === "null") {
    if (!NULLABLE_OPERATORS.has(cmp.op)) {
      throw new MonqueryError("invalid_value", `Operator '${cmp.op}' on '${cmp.key}' does not accept null`, cmp.position);
    }
    return null;
  }

  switch (field.type) {
    case "string":
      return literal.raw;
    case "number":
      return coerceNumber(literal, cmp);
    case "boolean":
      return coerceBoolean(literal, cmp);
    case "date":
      return coerceDate(literal, cmp);
  }
}

function coerceNumber(literal: Literal, cmp: Comparison): number {
  const value = literal.raw.trim() === "" ? NaN : Number(literal.raw);
  if (!Number.isFinite(value)) {
    throw new MonqueryError("invalid_value", `'${literal.raw}' is not a valid number for '${cmp.key}'`, cmp.position);
  }
  return value;
}

function coerceBoolean(literal: Literal, cmp: Comparison): boolean {
  const raw = literal.raw.toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new MonqueryError(
    "invalid_value",
    `'${literal.raw}' is not a valid boolean for '${cmp.key}', use true or false`,
    cmp.position
  );
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(T|$)/;

function coerceDate(literal: Literal, cmp: Comparison): Date {
  const value = new Date(literal.raw);
  if (!DATE_PREFIX.test(literal.raw) || Number.isNaN(value.getTime())) {
    throw new MonqueryError(
      "invalid_value",
      `'${literal.raw}' is not a valid ISO 8601 date for '${cmp.key}'`,
      cmp.position
    );
  }
  return value;
}

function validRegex(pattern: string, cmp: Comparison): string {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new MonqueryError(
      "invalid_value",
      `Regular expression for '${cmp.key}' exceeds ${MAX_REGEX_LENGTH} characters`,
      cmp.position
    );
  }
  try {
    new RegExp(pattern, "i");
  } catch {
    throw new MonqueryError("invalid_value", `Invalid regular expression for '${cmp.key}'`, cmp.position);
  }
  return pattern;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
