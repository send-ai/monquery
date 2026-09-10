/**
 * Every case here was a confirmed defect in monquery v1 (src/monquery). They are kept together so the
 * behaviour v2 promises stays pinned down when the parser is touched again.
 */
import { describe, expect, test } from "vitest";

import { checkFilter } from "../src/core/check";
import { toMongo } from "../src/mongo/compile";
import { combineQueries } from "../src/mongo/pagination";
import { parseFilter } from "../src/core/parser";
import { decodeCursor, encodeCursor } from "../src/mongo/token";

import { OID, config } from "./fixtures";

const compile = (input: string) => toMongo(checkFilter(parseFilter(input), config));

describe("v1 regressions", () => {
  test("values containing {n.n.n} no longer hang the event loop", () => {
    const started = Date.now();
    expect(compile("name eq 'a{1.2.3}b'")).toEqual({ name: { $eq: "a{1.2.3}b" } });
    expect(compile("name eq '{1}'")).toEqual({ name: { $eq: "{1}" } });
    expect(compile("name eq '{x}'")).toEqual({ name: { $eq: "{x}" } });
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("strings containing 'true' or 'false' are not turned into booleans", () => {
    expect(compile("name eq 'construe'")).toEqual({ name: { $eq: "construe" } });
    expect(compile("name eq 'falsehood'")).toEqual({ name: { $eq: "falsehood" } });
    expect(compile("name eq true")).toEqual({ name: { $eq: "true" } });
  });

  test("strings that look like /x/ are not turned into regexes", () => {
    expect(compile("name eq '/x/'")).toEqual({ name: { $eq: "/x/" } });
  });

  test("strings that look like dates stay strings on string fields", () => {
    expect(compile("name eq '2024-01-01T00:00:00.000Z'")).toEqual({ name: { $eq: "2024-01-01T00:00:00.000Z" } });
  });

  test("brackets inside quoted values are literal", () => {
    expect(compile("name regex 'Acme (Holding)'")).toEqual({ name: /Acme (Holding)/i });
    expect(compile("name contains 'Acme (Holding)'")).toEqual({ name: /Acme \(Holding\)/i });
  });

  test("unquoted numbers, null and dates followed by 'and' split correctly", () => {
    expect(compile("count gt 5 and name eq 'a'")).toEqual({ $and: [{ count: { $gt: 5 } }, { name: { $eq: "a" } }] });
    expect(compile("last_opened_at eq null and project_id eq 'p'")).toEqual({
      $and: [{ last_opened_at: { $eq: null } }, { project_id: { $eq: "p" } }],
    });
    expect(compile("last_opened_at gt 1970-01-01T00:00:00.000Z and project_id eq 'p'")).toEqual({
      $and: [{ last_opened_at: { $gt: new Date(0) } }, { project_id: { $eq: "p" } }],
    });
  });

  test("three or more bracket levels", () => {
    expect(compile("project_id eq p and (name eq a or (status eq x and (count gt 1 or count lt 0)))")).toEqual({
      $and: [
        { project_id: { $eq: "p" } },
        {
          $or: [
            { name: { $eq: "a" } },
            { $and: [{ status: { $eq: "x" } }, { $or: [{ count: { $gt: 1 } }, { count: { $lt: 0 } }] }] },
          ],
        },
      ],
    });
  });

  test("slashes in regex values are not stripped or turned into escapes", () => {
    expect(compile("name regex 'a/b'")).toEqual({ name: /a\/b/i });
    expect((compile("name regex 'a/b'").name as RegExp).test("A/B")).toBe(true);
  });

  test("list values are trimmed", () => {
    expect(compile("status in a, b")).toEqual({ status: { $in: ["a", "b"] } });
  });

  test("and/or on the same level no longer throw; precedence applies", () => {
    expect(compile("name eq a and status eq b or reported eq true")).toEqual({
      $or: [{ $and: [{ name: { $eq: "a" } }, { status: { $eq: "b" } }] }, { reported: { $eq: true } }],
    });
  });

  test("appended server-side constraints never overwrite the user's $or", () => {
    const user = compile("name eq a or name eq b");
    const enforced = { status: "ACTIVE", $or: [{ production_project_id: { $exists: false } }] };
    const combined = combineQueries(user, enforced);
    expect(combined).toEqual({ $and: [user, enforced] });
  });

  test("pagination tokens survive '!' in the sort value", () => {
    const token = encodeCursor({ id: OID, value: "Hi! there" });
    expect(decodeCursor(token, "string").value).toBe("Hi! there");
  });

  test("a partial sort key does not match", () => {
    expect(() => compile("nam eq 1")).toThrow(/not allowed to filter on 'nam'/);
  });
});
