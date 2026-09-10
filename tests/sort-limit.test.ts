import { describe, expect, test } from "vitest";

import { MonqueryError } from "../src/core/errors";
import { parseLimit } from "../src/core/limit";
import { DEFAULT_SORT, parseSort, sortStage } from "../src/core/sort";

import { config } from "./fixtures";

describe("parseSort", () => {
  test("defaults to _id asc", () => {
    expect(parseSort(undefined, config)).toEqual(DEFAULT_SORT);
    expect(parseSort("", config)).toEqual(DEFAULT_SORT);
  });

  test("parses key and direction, defaulting to asc", () => {
    expect(parseSort("name desc", config)).toEqual({ key: "name", path: "name", type: "string", direction: -1 });
    expect(parseSort("name", config)).toEqual({ key: "name", path: "name", type: "string", direction: 1 });
    expect(parseSort("created_at ASC", config)).toMatchObject({ type: "date", direction: 1 });
    expect(parseSort("  count   desc ", config)).toMatchObject({ key: "count", direction: -1 });
  });

  test("_id is always sortable", () => {
    expect(parseSort("_id desc", config)).toEqual({ key: "_id", path: "_id", type: "string", direction: -1 });
  });

  test("keys must match exactly", () => {
    expect(() => parseSort("nam asc", config)).toThrow(MonqueryError);
    expect(() => parseSort("nam asc", config)).toThrow(
      /Sort key 'nam' is invalid for this route, use one of: _id, status, name/
    );
    expect(() => parseSort("_idx asc", config)).toThrow(/invalid/);
  });

  test("filter-only keys are not sortable", () => {
    expect(() => parseSort("project_id asc", config)).toThrow(/Sort key 'project_id' is invalid/);
  });

  test("rejects bad direction or extra tokens", () => {
    expect(() => parseSort("name down", config)).toThrow(/Sort order should either be 'asc' or 'desc', got 'down'/);
    expect(() => parseSort("name asc extra", config)).toThrow(/Sort must be/);
  });
});

describe("sortStage", () => {
  test("adds _id as tiebreaker, but not twice", () => {
    expect(sortStage(parseSort("name desc", config))).toEqual({ name: -1, _id: -1 });
    expect(sortStage(parseSort("_id desc", config))).toEqual({ _id: -1 });
  });
});

describe("parseLimit", () => {
  test("defaults to the route maximum", () => {
    expect(parseLimit(undefined, config)).toBe(50);
    expect(parseLimit("", config)).toBe(50);
  });

  test("accepts whole numbers within range", () => {
    expect(parseLimit("1", config)).toBe(1);
    expect(parseLimit("50", config)).toBe(50);
    expect(parseLimit(" 10 ", config)).toBe(10);
  });

  test.each(["0", "51", "-1", "1.5", "abc", "1e1", "10abc"])("rejects %s", (raw) => {
    expect(() => parseLimit(raw, config)).toThrow(MonqueryError);
    expect(() => parseLimit(raw, config)).toThrow(/between 1 and 50/);
  });
});
