import { describe, expect, test } from "vitest";

import { defineQueryConfig } from "../src/core/config";
import { MonqueryError } from "../src/core/errors";
import { parseQuery, toRawQuery, validateQuery } from "../src/core/query";
import { toMongoQuery } from "../src/mongo/index";
import { encodeCursor } from "../src/mongo/token";

import { OID, config } from "./fixtures";

describe("toRawQuery", () => {
  test("accepts objects, URLSearchParams and strings; ignores unknown keys", () => {
    expect(toRawQuery({ filter: "a eq 1", foo: "bar" })).toEqual({ filter: "a eq 1" });
    expect(toRawQuery(new URLSearchParams("limit=5&sort=name+asc"))).toEqual({ limit: "5", sort: "name asc" });
    expect(toRawQuery("q=inv&token=t")).toEqual({ q: "inv", token: "t" });
    expect(toRawQuery(undefined)).toEqual({});
  });

  test("rejects repeated or nested parameters", () => {
    expect(() => toRawQuery({ filter: ["a", "b"] })).toThrow("Query parameter 'filter' must be a single string");
    expect(() => toRawQuery({ limit: { $gt: 1 } })).toThrow(MonqueryError);
  });
});

describe("parseQuery", () => {
  test("defaults", () => {
    expect(parseQuery({}, config)).toEqual({
      ast: null,
      filter: null,
      sort: { key: "_id", path: "_id", type: "string", direction: 1 },
      limit: 50,
      q: null,
      token: null,
    });
  });

  test("full query, database-free", () => {
    const result = parseQuery("filter=status eq A and count gt 1&sort=name desc&limit=10&q=inv&token=t", config);
    expect(result.ast?.type).toBe("and");
    expect(result.filter?.type).toBe("and");
    expect(result.sort).toMatchObject({ key: "name", direction: -1 });
    expect(result.limit).toBe(10);
    expect(result.q).toBe("inv");
    expect(result.token).toBe("t");
  });

  test("blank q and token are absent", () => {
    expect(parseQuery({ q: "  ", token: "" }, config)).toMatchObject({ q: null, token: null });
  });

  test("validateQuery returns instead of throwing", () => {
    const bad = validateQuery({ filter: "nope eq 1" }, config);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("unknown_field");
    const good = validateQuery({ filter: "name eq 1" }, config);
    expect(good.ok).toBe(true);
  });
});

describe("toMongoQuery", () => {
  test("compiles the match, decodes the cursor and prepares the text search stage", () => {
    const token = encodeCursor({ id: OID, value: "m" });
    const parsed = parseQuery({ filter: "status eq A", sort: "name asc", q: "inv", token }, config);
    const mongo = toMongoQuery(parsed, config);
    expect(mongo.match).toEqual({ status: { $eq: "A" } });
    expect(mongo.cursor).toEqual({ id: OID, value: "m" });
    expect(mongo.search).toEqual({ $text: { $search: "inv" } });
    expect(mongo.searchStage).toBeNull();
    expect(mongo.before).toEqual([{ $match: { $text: { $search: "inv" } } }]);
  });

  test("legacy tokens decode with the sort field's type", () => {
    const legacy = Buffer.from(`${OID}!42`).toString("base64");
    const parsed = parseQuery({ sort: "count asc", token: legacy }, config);
    expect(toMongoQuery(parsed, config).cursor).toEqual({ id: OID, value: 42 });
  });

  test("atlas search needs a database id", () => {
    const indexed = defineQueryConfig({ searchIndex: "docs-{database}", fields: { name: { type: "string" } } });
    const parsed = parseQuery({ q: "a*b" }, indexed);
    expect(() => toMongoQuery(parsed, indexed)).toThrow(/Search is not available/);
    const mongo = toMongoQuery(parsed, indexed, { databaseId: "db1" });
    expect(mongo.search).toBeNull();
    expect(mongo.searchStage).toEqual({
      $search: { index: "docs-db1", wildcard: { query: "*a\\*b*", allowAnalyzedField: true, path: { wildcard: "*" } } },
    });
    expect(mongo.before).toEqual([mongo.searchStage]);
    expect(toMongoQuery(parseQuery({}, indexed), indexed).searchStage).toBeNull();
  });
});
