import { describe, expect, test } from "vitest";

import { FilterNode } from "../src/core/ast";
import { MonqueryError } from "../src/core/errors";
import { MAX_NESTING_DEPTH, parseFilter } from "../src/core/parser";
import { serializeFilter } from "../src/core/serialize";

const cmp = (key: string, op: string, ...values: (string | [string])[]): FilterNode => ({
  type: "cmp",
  key,
  op,
  values: values.map((v) => (Array.isArray(v) ? { raw: v[0], quoted: true } : { raw: v, quoted: false })),
  position: expect.any(Number),
});

describe("parseFilter", () => {
  test("returns null for empty input", () => {
    expect(parseFilter(undefined)).toBeNull();
    expect(parseFilter("")).toBeNull();
    expect(parseFilter("   ")).toBeNull();
  });

  test("single comparison", () => {
    expect(parseFilter("name eq 'a'")).toEqual(cmp("name", "eq", ["a"]));
  });

  test("distinguishes quoted from bare literals", () => {
    expect(parseFilter("x eq null")).toEqual(cmp("x", "eq", "null"));
    expect(parseFilter("x eq 'null'")).toEqual(cmp("x", "eq", ["null"]));
  });

  test("and chains flatten", () => {
    expect(parseFilter("a eq 1 and b eq 2 and c eq 3")).toEqual({
      type: "and",
      nodes: [cmp("a", "eq", "1"), cmp("b", "eq", "2"), cmp("c", "eq", "3")],
    });
  });

  test("and binds tighter than or", () => {
    expect(parseFilter("a eq 1 and b eq 2 or c eq 3")).toEqual({
      type: "or",
      nodes: [{ type: "and", nodes: [cmp("a", "eq", "1"), cmp("b", "eq", "2")] }, cmp("c", "eq", "3")],
    });
  });

  test("brackets override precedence", () => {
    expect(parseFilter("a eq 1 and (b eq 2 or c eq 3)")).toEqual({
      type: "and",
      nodes: [cmp("a", "eq", "1"), { type: "or", nodes: [cmp("b", "eq", "2"), cmp("c", "eq", "3")] }],
    });
  });

  test("not applies to the next unary and can be stacked", () => {
    expect(parseFilter("not a eq 1 and b eq 2")).toEqual({
      type: "and",
      nodes: [{ type: "not", node: cmp("a", "eq", "1") }, cmp("b", "eq", "2")],
    });
    expect(parseFilter("not not (a eq 1 or b eq 2)")).toEqual({
      type: "not",
      node: { type: "not", node: { type: "or", nodes: [cmp("a", "eq", "1"), cmp("b", "eq", "2")] } },
    });
  });

  test("deep nesting works", () => {
    const deep = "a eq 1 and (b eq 2 or (c eq 3 and (d eq 4 or (e eq 5 and f eq 6))))";
    expect(parseFilter(deep)).toEqual({
      type: "and",
      nodes: [
        cmp("a", "eq", "1"),
        {
          type: "or",
          nodes: [
            cmp("b", "eq", "2"),
            {
              type: "and",
              nodes: [
                cmp("c", "eq", "3"),
                {
                  type: "or",
                  nodes: [cmp("d", "eq", "4"), { type: "and", nodes: [cmp("e", "eq", "5"), cmp("f", "eq", "6")] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("redundant brackets are transparent", () => {
    expect(parseFilter("((a eq 1))")).toEqual(cmp("a", "eq", "1"));
  });

  test("value lists with and without spaces, quoted or bare", () => {
    expect(parseFilter("s in a,b")).toEqual(cmp("s", "in", "a", "b"));
    expect(parseFilter("s in a, b ,c")).toEqual(cmp("s", "in", "a", "b", "c"));
    expect(parseFilter("s in 'a','b c'")).toEqual(cmp("s", "in", ["a"], ["b c"]));
  });

  test("empty value list before a keyword or end", () => {
    expect(parseFilter("s in")).toEqual(cmp("s", "in"));
    expect(parseFilter("s in and x eq 1")).toEqual({ type: "and", nodes: [cmp("s", "in"), cmp("x", "eq", "1")] });
  });

  test("keywords are case-insensitive, operators are lower-cased", () => {
    expect(parseFilter("a EQ 1 AND b Ne 2 Or NOT c eq 3")).toEqual({
      type: "or",
      nodes: [
        { type: "and", nodes: [cmp("a", "eq", "1"), cmp("b", "ne", "2")] },
        { type: "not", node: cmp("c", "eq", "3") },
      ],
    });
  });

  test("keywords inside quotes are values", () => {
    expect(parseFilter("name eq 'salt and pepper' and s eq 'or'")).toEqual({
      type: "and",
      nodes: [cmp("name", "eq", ["salt and pepper"]), cmp("s", "eq", ["or"])],
    });
  });

  test("bare values followed by keywords split correctly", () => {
    expect(parseFilter("count gt 5 and x eq null or y eq 2024-01-01T00:00:00.000Z and z eq true")).toEqual({
      type: "or",
      nodes: [
        { type: "and", nodes: [cmp("count", "gt", "5"), cmp("x", "eq", "null")] },
        { type: "and", nodes: [cmp("y", "eq", "2024-01-01T00:00:00.000Z"), cmp("z", "eq", "true")] },
      ],
    });
  });

  describe("errors", () => {
    const bad: [string, RegExp][] = [
      ["name eq 'a' and", /expected a field name/],
      ["name eq 'a' or", /expected a field name/],
      ["and name eq 'a'", /expected a field name/],
      ["name", /expected an operator after 'name'/],
      ["name eq 'a' status eq 'b'", /Unexpected 'status', expected end of filter/],
      ["(name eq 'a'", /expected '\)'/],
      ["name eq 'a')", /Unexpected '\)', expected end of filter/],
      ["()", /expected a field name/],
      ["name eq 'a',", /expected a value/],
      ["name eq ,", /Unexpected ','/],
      ["not", /expected a field name/],
    ];

    test.each(bad)("%s", (input, message) => {
      expect(() => parseFilter(input)).toThrow(MonqueryError);
      expect(() => parseFilter(input)).toThrow(message);
    });

    test("nesting beyond the limit is rejected, not stack-overflowed", () => {
      const deep = "(".repeat(MAX_NESTING_DEPTH + 1) + "a eq 1" + ")".repeat(MAX_NESTING_DEPTH + 1);
      expect(() => parseFilter(deep)).toThrow(/maximum nesting depth/);
      const ok = "(".repeat(MAX_NESTING_DEPTH) + "a eq 1" + ")".repeat(MAX_NESTING_DEPTH);
      expect(parseFilter(ok)).toEqual(cmp("a", "eq", "1"));
    });
  });
});

describe("serializeFilter", () => {
  const roundtrips = [
    "name eq 'a'",
    "count gt 5",
    "x eq null",
    "x eq 'null'",
    "s in a,b,c",
    "s in 'a b','c,d'",
    "s in",
    "a eq 1 and b eq 2 and c eq 3",
    "a eq 1 or b eq 2",
    "a eq 1 and (b eq 2 or c eq 3)",
    "(a eq 1 and b eq 2) or c eq 3",
    "not a eq 1",
    "not (a eq 1 and b eq 2)",
    "not (a eq 1 or b eq 2) and c eq 3",
    "name eq 'it''s (fine), really'",
    "name eq 'and'",
    "name eq ''",
  ];

  const withoutPositions = (node: FilterNode | null): unknown =>
    node && JSON.parse(JSON.stringify(node, (key, value) => (key === "position" ? undefined : value)));

  test.each(roundtrips)("parse(serialize(parse(%s))) is stable", (input) => {
    const ast = parseFilter(input);
    const text = serializeFilter(ast);
    expect(withoutPositions(parseFilter(text))).toEqual(withoutPositions(ast));
    expect(serializeFilter(parseFilter(text))).toBe(text);
  });

  test("normalizes spacing and casing", () => {
    expect(serializeFilter(parseFilter("a   EQ 1 AND  b  ne   2"))).toBe("a eq 1 and b ne 2");
  });

  test("drops redundant brackets and adds required ones", () => {
    expect(serializeFilter(parseFilter("((a eq 1)) and (b eq 2)"))).toBe("a eq 1 and b eq 2");
    expect(serializeFilter(parseFilter("a eq 1 and (b eq 2 or c eq 3)"))).toBe("a eq 1 and (b eq 2 or c eq 3)");
  });

  test("quotes bare words that would otherwise be misread", () => {
    expect(
      serializeFilter({ type: "cmp", key: "n", op: "eq", values: [{ raw: "a b", quoted: false }], position: 0 })
    ).toBe("n eq 'a b'");
    expect(
      serializeFilter({ type: "cmp", key: "n", op: "eq", values: [{ raw: "or", quoted: false }], position: 0 })
    ).toBe("n eq 'or'");
  });

  test("empty AST serializes to empty string", () => {
    expect(serializeFilter(null)).toBe("");
  });
});
