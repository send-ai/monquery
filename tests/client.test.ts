import { describe, expect, test } from "vitest";

import { f, quote, raw, toFilterString } from "../src/client/builder";
import { comparisons, facetValues, getFacet, removeFacet, setFacet } from "../src/client/facets";
import { buildQueryString, buildSearchParams, normalizeSearchQuery } from "../src/client/query-string";
import { parseFilter } from "../src/core/parser";
import { validateQuery } from "../src/core/query";

import { config } from "./fixtures";

describe("quote", () => {
  test("wraps and doubles inner quotes", () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
    expect(quote("")).toBe("''");
  });
});

describe("f", () => {
  test("literals by type", () => {
    expect(f.eq("name", "a b").text).toBe("name eq 'a b'");
    expect(f.gt("count", 5).text).toBe("count gt 5");
    expect(f.eq("reported", true).text).toBe("reported eq true");
    expect(f.eq("x", null).text).toBe("x eq null");
    expect(f.lt("created_at", new Date("2024-01-02T03:04:05.000Z")).text).toBe("created_at lt 2024-01-02T03:04:05.000Z");
  });

  test("lists", () => {
    expect(f.in("status", ["A", "B"]).text).toBe("status in 'A','B'");
    expect(f.in("status", []).text).toBe("status in ");
  });

  test("and skips falsy entries and collapses singletons", () => {
    expect(f.and()).toBeNull();
    expect(f.and(null, false, undefined)).toBeNull();
    expect(f.and(f.eq("a", 1))?.text).toBe("a eq 1");
    expect(f.and(f.eq("a", 1), null, f.eq("b", 2))?.text).toBe("a eq 1 and b eq 2");
  });

  test("parenthesizes or inside and, and and/or inside not", () => {
    const or = f.or(f.eq("a", 1), f.eq("b", 2))!;
    expect(f.and(f.eq("c", 3), or)?.text).toBe("c eq 3 and (a eq 1 or b eq 2)");
    expect(f.or(f.and(f.eq("a", 1), f.eq("b", 2)), f.eq("c", 3))?.text).toBe("a eq 1 and b eq 2 or c eq 3");
    expect(f.not(or).text).toBe("not (a eq 1 or b eq 2)");
    expect(f.not(f.eq("a", 1)).text).toBe("not a eq 1");
  });

  test("raw user filters are bracketed when combined", () => {
    expect(f.and(f.eq("p", "x"), raw("a eq 1 or b eq 2"))?.text).toBe("p eq 'x' and (a eq 1 or b eq 2)");
    expect(raw("  ")).toBeNull();
  });

  test("between and isSet", () => {
    const from = new Date("2024-01-01T00:00:00.000Z");
    expect(f.between("created_at", {})).toBeNull();
    expect(f.between("created_at", { from })?.text).toBe("created_at gt 2024-01-01T00:00:00.000Z");
    expect(f.between("created_at", { from, to: "2024-02-01" })?.text).toBe("created_at gt 2024-01-01T00:00:00.000Z and created_at lt '2024-02-01'");
    expect(f.isSet("last_opened_at", true).text).toBe("last_opened_at gt 1970-01-01T00:00:00.000Z");
    expect(f.isSet("last_opened_at", false).text).toBe("last_opened_at eq null");
  });

  test("everything the builder emits parses and checks against a config", () => {
    const clause = f.and(
      f.eq("project_id", "p'1"),
      f.in("status", ["A", "B"]),
      f.contains("name", "Acme (Holding) 'and' or"),
      f.or(f.gt("count", 5), f.isNull("count")),
      f.not(f.eq("reported", true)),
      f.between("created_at", { from: new Date(0) })
    );
    const result = validateQuery({ filter: toFilterString(clause) }, config);
    expect(result.ok).toBe(true);
  });
});

describe("query string", () => {
  test("stable key order, absent values omitted", () => {
    const qs = buildQueryString({ limit: 50, sort: { key: "created_at", direction: "desc" }, q: "inv", filter: f.eq("project_id", "p1"), token: "t" });
    expect(qs).toBe("limit=50&sort=created_at+desc&q=inv&filter=project_id+eq+%27p1%27&token=t");
    expect(buildQueryString({})).toBe("");
    expect(buildQueryString({ q: '""', filter: null, token: null })).toBe("");
    expect(buildQueryString({ filter: "a eq 1", sort: "name asc" })).toBe("sort=name+asc&filter=a+eq+1");
    expect(buildSearchParams({ limit: 5 }).get("limit")).toBe("5");
  });

  test("normalizeSearchQuery", () => {
    expect(normalizeSearchQuery(undefined)).toBeUndefined();
    expect(normalizeSearchQuery("")).toBeUndefined();
    expect(normalizeSearchQuery('"   "')).toBeUndefined();
    expect(normalizeSearchQuery('"foo"')).toBe('"foo"');
  });

  test("round-trips through parseQuery", () => {
    const qs = buildQueryString({ limit: 10, sort: { key: "name", direction: "asc" }, filter: f.eq("status", "A") });
    const result = validateQuery(qs, config);
    expect(result.ok && result.query).toMatchObject({ limit: 10, sort: { key: "name", direction: 1 } });
  });
});

describe("facets", () => {
  const url = "project_id eq 'p' and status in A,B and (name eq x or name eq y) and created_at gt 2024-01-01";

  test("comparisons lists only the top-level and-chain", () => {
    expect(comparisons(url).map((c) => c.key)).toEqual(["project_id", "status", "created_at"]);
    expect(comparisons("a eq 1")).toHaveLength(1);
    expect(comparisons("a eq 1 or b eq 2")).toEqual([]);
    expect(comparisons(null)).toEqual([]);
  });

  test("getFacet and facetValues", () => {
    expect(facetValues(getFacet(url, "status"))).toEqual(["A", "B"]);
    expect(facetValues(getFacet(url, "status", ["eq"]))).toEqual([]);
    expect(getFacet(url, "missing")).toBeUndefined();
  });

  test("setFacet replaces one key and keeps unknown groups verbatim", () => {
    const next = setFacet(url, "status", f.in("status", ["C"]));
    expect(next).toBe("project_id eq 'p' and (name eq x or name eq y) and created_at gt 2024-01-01 and status in 'C'");
    expect(setFacet(url, "created_at", null)).toBe("project_id eq 'p' and status in A,B and (name eq x or name eq y)");
    expect(setFacet("", "status", f.eq("status", "A"))).toBe("status eq 'A'");
    expect(setFacet("status eq A", "status", null)).toBe("");
  });

  test("setFacet with a multi-clause value flattens into the chain", () => {
    expect(setFacet("p eq 1", "created_at", f.between("created_at", { from: "2024-01-01", to: "2024-02-01" }))).toBe(
      "p eq 1 and created_at gt '2024-01-01' and created_at lt '2024-02-01'"
    );
  });

  test("removeFacet", () => {
    expect(removeFacet("a eq 1 and b eq 2 and a eq 3", "a")).toBe("b eq 2");
    expect(removeFacet(parseFilter("a eq 1"), "a")).toBeNull();
  });

  test("AST in, AST out", () => {
    const ast = setFacet(parseFilter("a eq 1"), "b", f.eq("b", 2));
    expect(ast).toMatchObject({ type: "and", nodes: [{ key: "a" }, { key: "b" }] });
  });
});
