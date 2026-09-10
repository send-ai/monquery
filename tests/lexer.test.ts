import { describe, expect, test } from "vitest";

import { MonqueryError } from "../src/core/errors";
import { MAX_FILTER_LENGTH, tokenize } from "../src/core/lexer";

const types = (input: string) => tokenize(input).map((t) => t.type);
const values = (input: string) => tokenize(input).map((t) => t.value);

describe("tokenize", () => {
  test("splits words, quoted strings, brackets and commas", () => {
    expect(types("name eq 'a' and (count in 1,2)")).toEqual([
      "word",
      "word",
      "string",
      "word",
      "lparen",
      "word",
      "word",
      "word",
      "comma",
      "word",
      "rparen",
      "eof",
    ]);
  });

  test("collapses any whitespace, including newlines and tabs", () => {
    expect(values("name \n\t eq   'a'")).toEqual(["name", "eq", "a", ""]);
  });

  test("keeps everything inside quotes verbatim, including brackets, commas and keywords", () => {
    expect(values("name eq 'Acme (Holding), and or not'")).toEqual(["name", "eq", "Acme (Holding), and or not", ""]);
  });

  test("supports doubled-quote escaping", () => {
    expect(values("name eq 'O''Brien'")).toEqual(["name", "eq", "O'Brien", ""]);
  });

  test("backslashes are literal so regex escapes survive", () => {
    expect(values("name regex '\\bfoo\\.pdf$'")).toEqual(["name", "regex", "\\bfoo\\.pdf$", ""]);
    expect(values("name eq 'a\\'")).toEqual(["name", "eq", "a\\", ""]);
  });

  test("empty quoted string is a string token", () => {
    const [, , value] = tokenize("name eq ''");
    expect(value).toMatchObject({ type: "string", value: "" });
  });

  test("records positions", () => {
    expect(tokenize("ab cd").map((t) => t.position)).toEqual([0, 3, 5]);
  });

  test("bare words may contain double quotes, dashes, dots and colons", () => {
    expect(values(`x eq 2024-01-01T00:00:00.000Z and y eq it"s`)).toEqual([
      "x",
      "eq",
      "2024-01-01T00:00:00.000Z",
      "and",
      "y",
      "eq",
      'it"s',
      "",
    ]);
  });

  test("throws on unterminated string with position", () => {
    expect(() => tokenize("name eq 'abc")).toThrow(MonqueryError);
    expect(() => tokenize("name eq 'abc")).toThrow("Unterminated quoted string (at position 8)");
  });

  test("throws on over-long input", () => {
    expect(() => tokenize("x".repeat(MAX_FILTER_LENGTH + 1))).toThrow(/maximum length/);
  });
});
