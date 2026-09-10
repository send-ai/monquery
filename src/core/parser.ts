import { FilterNode, KEYWORDS, Literal } from "./ast";
import { MonqueryError } from "./errors";
import { Token, tokenize } from "./lexer";

export const MAX_NESTING_DEPTH = 32;

/**
 * Grammar (precedence low to high: or, and, not):
 *
 *   filter     := orExpr EOF
 *   orExpr     := andExpr ('or' andExpr)*
 *   andExpr    := unary ('and' unary)*
 *   unary      := 'not' unary | primary
 *   primary    := '(' orExpr ')' | comparison
 *   comparison := WORD WORD valueList
 *   valueList  := (value (',' value)*)?
 *   value      := STRING | WORD
 *
 * Returns null for an empty filter.
 */
export function parseFilter(input: string | undefined | null): FilterNode | null {
  if (input == null || input.trim() === "") return null;
  const parser = new Parser(tokenize(input));
  const node = parser.parseOr(0);
  parser.expect("eof");
  return node;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private isKeyword(token: Token, keyword: string): boolean {
    return token.type === "word" && token.value.toLowerCase() === keyword;
  }

  expect(type: Token["type"]): Token {
    const token = this.peek();
    if (token.type !== type) {
      const expected = type === "eof" ? "end of filter" : type === "rparen" ? "')'" : type;
      throw new MonqueryError("syntax", `Unexpected ${describe(token)}, expected ${expected}`, token.position);
    }
    return this.next();
  }

  parseOr(depth: number): FilterNode {
    const nodes = [this.parseAnd(depth)];
    while (this.isKeyword(this.peek(), "or")) {
      this.next();
      nodes.push(this.parseAnd(depth));
    }
    return nodes.length === 1 ? nodes[0] : { type: "or", nodes };
  }

  private parseAnd(depth: number): FilterNode {
    const nodes = [this.parseUnary(depth)];
    while (this.isKeyword(this.peek(), "and")) {
      this.next();
      nodes.push(this.parseUnary(depth));
    }
    return nodes.length === 1 ? nodes[0] : { type: "and", nodes };
  }

  private parseUnary(depth: number): FilterNode {
    if (this.isKeyword(this.peek(), "not")) {
      this.next();
      return { type: "not", node: this.parseUnary(depth) };
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): FilterNode {
    const token = this.peek();

    if (token.type === "lparen") {
      if (depth + 1 > MAX_NESTING_DEPTH) {
        throw new MonqueryError("syntax", `Filter exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}`, token.position);
      }
      this.next();
      const node = this.parseOr(depth + 1);
      this.expect("rparen");
      return node;
    }

    if (token.type !== "word" || KEYWORDS.has(token.value.toLowerCase())) {
      throw new MonqueryError("syntax", `Unexpected ${describe(token)}, expected a field name`, token.position);
    }
    const key = this.next();

    const op = this.peek();
    if (op.type !== "word" || KEYWORDS.has(op.value.toLowerCase())) {
      throw new MonqueryError("syntax", `Unexpected ${describe(op)}, expected an operator after '${key.value}'`, op.position);
    }
    this.next();

    return {
      type: "cmp",
      key: key.value,
      op: op.value.toLowerCase(),
      values: this.parseValueList(),
      position: key.position,
    };
  }

  private parseValueList(): Literal[] {
    const values: Literal[] = [];
    if (!this.isValue(this.peek())) return values;

    values.push(this.parseValue());
    while (this.peek().type === "comma") {
      this.next();
      values.push(this.parseValue());
    }
    return values;
  }

  private isValue(token: Token): boolean {
    if (token.type === "string") return true;
    return token.type === "word" && !KEYWORDS.has(token.value.toLowerCase());
  }

  private parseValue(): Literal {
    const token = this.peek();
    if (!this.isValue(token)) {
      throw new MonqueryError("syntax", `Unexpected ${describe(token)}, expected a value`, token.position);
    }
    this.next();
    return { raw: token.value, quoted: token.type === "string" };
  }
}

function describe(token: Token): string {
  if (token.type === "eof") return "end of filter";
  return `'${token.value}'`;
}
