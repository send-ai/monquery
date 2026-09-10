import { CheckedComparison, CheckedFilter } from "../core/check";

export type MongoFilter = Record<string, unknown>;

/** Emits a MongoDB filter document from a checked filter. All validation already happened in `checkFilter`. */
export function toMongo(node: CheckedFilter | null): MongoFilter {
  if (!node) return {};
  return compileNode(node);
}

function compileNode(node: CheckedFilter): MongoFilter {
  switch (node.type) {
    case "and":
      return { $and: node.nodes.map(compileNode) };
    case "or":
      return { $or: node.nodes.map(compileNode) };
    case "not":
      return { $nor: [compileNode(node.node)] };
    case "cmp":
      return compileComparison(node);
  }
}

function compileComparison(cmp: CheckedComparison): MongoFilter {
  const { path } = cmp;
  switch (cmp.kind) {
    case "exists":
      return { [path]: { $exists: cmp.value } };
    case "pattern":
      return { [path]: new RegExp(cmp.pattern, "i") };
    case "patterns":
      return { [path]: { [cmp.op === "inregex" ? "$in" : "$nin"]: cmp.patterns.map((p) => new RegExp(p, "i")) } };
    case "list":
      return { [path]: { [`$${cmp.op}`]: cmp.values } };
    case "value":
      return { [path]: { [`$${cmp.op}`]: cmp.value } };
  }
}
