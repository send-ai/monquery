import { MonqueryError } from "./errors";

export type TokenType = "word" | "string" | "lparen" | "rparen" | "comma" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export const MAX_FILTER_LENGTH = 4096;

const isWhitespace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
const isDelimiter = (c: string) => isWhitespace(c) || c === "(" || c === ")" || c === "," || c === "'";

/**
 * Splits a filter string into tokens. Inside quotes only one escape exists: a doubled quote
 * (`'it''s'`). Backslashes are literal so regex patterns such as `'\bfoo'` pass through unchanged.
 */
export function tokenize(input: string): Token[] {
  if (input.length > MAX_FILTER_LENGTH) {
    throw new MonqueryError("syntax", `Filter exceeds maximum length of ${MAX_FILTER_LENGTH} characters`);
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    if (c === "(" || c === ")" || c === ",") {
      tokens.push({ type: c === "(" ? "lparen" : c === ")" ? "rparen" : "comma", value: c, position: i });
      i++;
      continue;
    }

    if (c === "'") {
      const start = i;
      let value = "";
      let closed = false;
      i++;
      while (i < input.length) {
        const ch = input[i];
        if (ch === "'") {
          if (input[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        value += ch;
        i++;
      }
      if (!closed) throw new MonqueryError("syntax", "Unterminated quoted string", start);
      tokens.push({ type: "string", value, position: start });
      continue;
    }

    const start = i;
    while (i < input.length && !isDelimiter(input[i])) i++;
    tokens.push({ type: "word", value: input.slice(start, i), position: start });
  }

  tokens.push({ type: "eof", value: "", position: input.length });
  return tokens;
}
