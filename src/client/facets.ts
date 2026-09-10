import { Comparison, FilterNode } from "../core/ast";
import { parseFilter } from "../core/parser";
import { serializeFilter } from "../core/serialize";
import { Clause } from "./builder";

/**
 * Facet helpers: treat a filter string as the URL state of a page and read or replace one field's
 * clause at a time, leaving everything else (including clauses the UI does not know about) intact.
 * Only the top-level `and` chain is editable; `or`/`not` groups are kept as opaque units.
 */

/** Top-level comparisons of a filter, in order. Nested `or`/`not` groups are not descended into. */
export function comparisons(filter: FilterNode | string | null | undefined): Comparison[] {
  const ast = typeof filter === "string" ? parseFilter(filter) : filter;
  if (!ast) return [];
  if (ast.type === "cmp") return [ast];
  if (ast.type === "and") return ast.nodes.filter((n): n is Comparison => n.type === "cmp");
  return [];
}

/** First top-level comparison on `key`, optionally restricted to some operators. */
export function getFacet(
  filter: FilterNode | string | null | undefined,
  key: string,
  ops?: readonly string[]
): Comparison | undefined {
  return comparisons(filter).find((c) => c.key === key && (!ops || ops.includes(c.op)));
}

/** Raw values of a comparison, e.g. `['A', 'B']` for `status in A,B`. */
export function facetValues(cmp: Comparison | undefined): string[] {
  return cmp ? cmp.values.map((v) => v.raw) : [];
}

/**
 * Returns a new filter with every top-level comparison on `key` removed and `clause` appended
 * (when given). Returns the serialized string when a string went in, an AST otherwise.
 */
export function setFacet(filter: string, key: string, clause: Clause | string | null): string;
export function setFacet(filter: FilterNode | null, key: string, clause: Clause | string | null): FilterNode | null;
export function setFacet(
  filter: FilterNode | string | null,
  key: string,
  clause: Clause | string | null
): FilterNode | string | null {
  const ast = typeof filter === "string" ? parseFilter(filter) : filter;
  const kept = topLevelNodes(ast).filter((n) => !(n.type === "cmp" && n.key === key));
  const added = clause ? parseFilter(typeof clause === "string" ? clause : clause.text) : null;
  const nodes = added ? [...kept, ...topLevelNodes(added)] : kept;

  const result: FilterNode | null = nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] : { type: "and", nodes };
  return typeof filter === "string" ? serializeFilter(result) : result;
}

/** Removes every top-level comparison on `key`. */
export function removeFacet(filter: string, key: string): string;
export function removeFacet(filter: FilterNode | null, key: string): FilterNode | null;
export function removeFacet(filter: FilterNode | string | null, key: string): FilterNode | string | null {
  return typeof filter === "string" ? setFacet(filter, key, null) : setFacet(filter, key, null);
}

function topLevelNodes(ast: FilterNode | null): FilterNode[] {
  if (!ast) return [];
  return ast.type === "and" ? ast.nodes : [ast];
}
