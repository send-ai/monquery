import { FilterNode, KEYWORDS, Literal } from "./ast";

const NEEDS_QUOTES = /[\s(),']/;

export function serializeLiteral(literal: Literal): string {
  const { raw, quoted } = literal;
  if (!quoted && raw !== "" && !NEEDS_QUOTES.test(raw) && !KEYWORDS.has(raw.toLowerCase())) return raw;
  return `'${raw.replace(/'/g, "''")}'`;
}

/** Renders an AST back to filter syntax. `parseFilter(serializeFilter(ast))` is structurally equal to `ast`. */
export function serializeFilter(node: FilterNode | null): string {
  if (!node) return "";

  switch (node.type) {
    case "cmp": {
      const values = node.values.map(serializeLiteral).join(",");
      return values === "" ? `${node.key} ${node.op}` : `${node.key} ${node.op} ${values}`;
    }
    case "not":
      return `not ${wrap(node.node, ["and", "or"])}`;
    case "and":
      return node.nodes.map((n) => wrap(n, ["or"])).join(" and ");
    case "or":
      return node.nodes.map((n) => serializeFilter(n)).join(" or ");
  }
}

function wrap(node: FilterNode, parenthesize: FilterNode["type"][]): string {
  const inner = serializeFilter(node);
  return parenthesize.includes(node.type) ? `(${inner})` : inner;
}
