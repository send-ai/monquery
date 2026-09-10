import { describe, expect, test } from "vitest";

import { MAX_REGEX_LENGTH, checkFilter, escapeRegex } from "../src/core/check";
import { MonqueryError } from "../src/core/errors";
import { parseFilter } from "../src/core/parser";
import { toMongo } from "../src/mongo/compile";

import { config } from "./fixtures";

const compile = (input: string) => toMongo(checkFilter(parseFilter(input), config));
const check = (input: string) => checkFilter(parseFilter(input), config);

describe("checkFilter", () => {
  test("empty filter", () => {
    expect(check("")).toBeNull();
    expect(compile("")).toEqual({});
  });

  test("produces a typed, path-resolved tree without any Mongo syntax", () => {
    expect(check("entity_ids in e1,e2 and count gt '5'")).toEqual({
      type: "and",
      nodes: [
        { type: "cmp", key: "entity_ids", path: "entities.id", op: "in", fieldType: "string", kind: "list", values: ["e1", "e2"] },
        { type: "cmp", key: "count", path: "count", op: "gt", fieldType: "number", kind: "value", value: 5 },
      ],
    });
  });

  test("patterns are plain strings so the checked tree is JSON-safe", () => {
    expect(check("name contains 'a.b'")).toMatchObject({ kind: "pattern", pattern: "a\\.b" });
    expect(check("name startswith 'Inv'")).toMatchObject({ kind: "pattern", pattern: "^Inv" });
    expect(check("name regex '^x$'")).toMatchObject({ kind: "pattern", pattern: "^x$" });
    expect(JSON.parse(JSON.stringify(check("name inregex a,b")))).toMatchObject({ kind: "patterns", patterns: ["a", "b"] });
  });

  test("errors carry a code and position", () => {
    try {
      check("name eq 'a' and foo eq 1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MonqueryError);
      expect((err as MonqueryError).code).toBe("unknown_field");
      expect((err as MonqueryError).position).toBe(16);
      expect((err as MonqueryError).status).toBe(400);
    }
    expect(() => check("name gt 1")).toThrow(/Operator 'gt' is not allowed for 'name' \(string\)/);
    expect(() => check("count gt abc")).toThrow(/'abc' is not a valid number for 'count'/);
    expect(() => check("reported eq 1")).toThrow(/not a valid boolean/);
    expect(() => check("created_at gt 'March 2024'")).toThrow(/not a valid ISO 8601 date/);
    expect(() => check("name eq")).toThrow(/requires a value/);
    expect(() => check("name eq a,b")).toThrow(/accepts a single value/);
    expect(() => check("count gt null")).toThrow(/does not accept null/);
    expect(() => check("internal eq 1")).toThrow(/not allowed to filter on 'internal'/);
    expect(() => check("name regex '('")).toThrow(/Invalid regular expression/);
    expect(() => check(`name regex '${"a".repeat(MAX_REGEX_LENGTH + 1)}'`)).toThrow(/exceeds/);
  });
});

describe("toMongo", () => {
  test("strings", () => {
    expect(compile("name eq 'a'")).toEqual({ name: { $eq: "a" } });
    expect(compile("status in A,B")).toEqual({ status: { $in: ["A", "B"] } });
    expect(compile("name eq null")).toEqual({ name: { $eq: null } });
    expect(compile("name eq 'null'")).toEqual({ name: { $eq: "null" } });
    expect(compile("name eq 5")).toEqual({ name: { $eq: "5" } });
    expect(compile("name eq true")).toEqual({ name: { $eq: "true" } });
  });

  test("regex family", () => {
    expect(compile("name regex 'a/b'")).toEqual({ name: /a\/b/i });
    expect(compile("name regex '\\bfoo'")).toEqual({ name: /\bfoo/i });
    expect(compile("name inregex a,b")).toEqual({ name: { $in: [/a/i, /b/i] } });
    expect(compile("name ninregex a,b")).toEqual({ name: { $nin: [/a/i, /b/i] } });
    expect(compile("name contains 'a.b (c)'")).toEqual({ name: /a\.b \(c\)/i });
    expect(compile("name startswith 'Inv*'")).toEqual({ name: /^Inv\*/i });
    expect(compile("name endswith '.pdf'")).toEqual({ name: /\.pdf$/i });
  });

  test("exists, numbers, booleans, dates", () => {
    expect(compile("name exists false")).toEqual({ name: { $exists: false } });
    expect(compile("count lte '5.5'")).toEqual({ count: { $lte: 5.5 } });
    expect(compile("count in 1,2")).toEqual({ count: { $in: [1, 2] } });
    expect(compile("reported ne FALSE")).toEqual({ reported: { $ne: false } });
    expect(compile("created_at gte 2024-01-02")).toEqual({ created_at: { $gte: new Date("2024-01-02T00:00:00.000Z") } });
    expect(compile("last_opened_at eq null")).toEqual({ last_opened_at: { $eq: null } });
  });

  test("logic", () => {
    expect(compile("name eq a and status eq b")).toEqual({ $and: [{ name: { $eq: "a" } }, { status: { $eq: "b" } }] });
    expect(compile("name eq a or name eq b")).toEqual({ $or: [{ name: { $eq: "a" } }, { name: { $eq: "b" } }] });
    expect(compile("not name eq a")).toEqual({ $nor: [{ name: { $eq: "a" } }] });
    expect(compile("project_id eq p and (name eq a or (status eq x and reported eq true))")).toEqual({
      $and: [
        { project_id: { $eq: "p" } },
        { $or: [{ name: { $eq: "a" } }, { $and: [{ status: { $eq: "x" } }, { reported: { $eq: true } }] }] },
      ],
    });
  });

  test("mongo operators cannot be smuggled in", () => {
    expect(() => compile("$where eq 1")).toThrow(/not allowed to filter on '\$where'/);
    expect(compile("name eq '$ne'")).toEqual({ name: { $eq: "$ne" } });
  });
});

describe("escapeRegex", () => {
  test("escapes every metacharacter", () => {
    const special = ".*+?^${}()|[]\\";
    expect(new RegExp(escapeRegex(special)).test(special)).toBe(true);
    expect(new RegExp(escapeRegex("a.b")).test("axb")).toBe(false);
  });
});
