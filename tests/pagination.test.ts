import { ObjectId } from "mongodb";
import { describe, expect, test, vi } from "vitest";

import { buildPaginatedPipeline, combineQueries, cursorMatch, paginate, toPage } from "../src/mongo/pagination";
import { SortSpec } from "../src/core/sort";
import { decodeCursor, encodeCursor } from "../src/mongo/token";

import { OID, OID2 } from "./fixtures";

const asc: SortSpec = { key: "name", path: "name", type: "string", direction: 1 };
const desc: SortSpec = { ...asc, direction: -1 };
const byId: SortSpec = { key: "_id", path: "_id", type: "string", direction: 1 };
const id = new ObjectId(OID);

describe("combineQueries", () => {
  test("drops empty and missing queries", () => {
    expect(combineQueries({}, null, undefined)).toEqual({});
    expect(combineQueries({ a: 1 }, {}, null)).toEqual({ a: 1 });
  });

  test("wraps two or more in $and so top-level keys never collide", () => {
    const user = { $or: [{ name: "a" }, { name: "b" }] };
    const enforced = { status: "ACTIVE", $or: [{ x: { $exists: false } }] };
    expect(combineQueries(user, enforced)).toEqual({ $and: [user, enforced] });
  });
});

describe("cursorMatch", () => {
  test("no cursor, no condition", () => {
    expect(cursorMatch(null, asc)).toBeNull();
  });

  test("sorting on _id compares _id only", () => {
    expect(cursorMatch({ id: OID, value: null }, byId)).toEqual({ _id: { $gt: id } });
    expect(cursorMatch({ id: OID, value: null }, { ...byId, direction: -1 })).toEqual({ _id: { $lt: id } });
  });

  test("ascending after a value: greater value, or same value with greater _id; nulls already passed", () => {
    expect(cursorMatch({ id: OID, value: "m" }, asc)).toEqual({
      $or: [{ name: { $gt: "m" } }, { name: "m", _id: { $gt: id } }],
    });
  });

  test("descending after a value: smaller value, same value with smaller _id, or the nulls that come last", () => {
    expect(cursorMatch({ id: OID, value: "m" }, desc)).toEqual({
      $or: [
        { name: { $lt: "m" } },
        { name: "m", _id: { $lt: id } },
        { $or: [{ name: null }, { name: { $exists: false } }] },
      ],
    });
  });

  test("ascending after a null: remaining nulls by _id, then everything non-null", () => {
    expect(cursorMatch({ id: OID, value: null }, asc)).toEqual({
      $or: [{ $or: [{ name: null }, { name: { $exists: false } }], _id: { $gt: id } }, { name: { $ne: null } }],
    });
  });

  test("descending after a null: only remaining nulls by _id", () => {
    expect(cursorMatch({ id: OID, value: null }, desc)).toEqual({
      $or: [{ name: null }, { name: { $exists: false } }],
      _id: { $lt: id },
    });
  });

  test("keeps value types", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(cursorMatch({ id: OID, value: date }, { ...asc, path: "created_at", type: "date" })).toEqual({
      $or: [{ created_at: { $gt: date } }, { created_at: date, _id: { $gt: id } }],
    });
    expect(cursorMatch({ id: OID, value: 5 }, { ...asc, path: "count", type: "number" })).toEqual({
      $or: [{ count: { $gt: 5 } }, { count: 5, _id: { $gt: id } }],
    });
  });
});

describe("buildPaginatedPipeline", () => {
  test("first page", () => {
    expect(buildPaginatedPipeline({ match: { status: "A" }, sort: desc, limit: 10, cursor: null })).toEqual([
      { $match: { status: "A" } },
      { $sort: { name: -1, _id: -1 } },
      { $limit: 11 },
    ]);
  });

  test("next page combines the match and the cursor with $and, and keeps before/after stages in place", () => {
    const search = { $search: { index: "i" } } as never;
    const lookup = { $lookup: { from: "members", as: "members", localField: "m", foreignField: "u" } };
    const pipeline = buildPaginatedPipeline({
      match: { status: "A" },
      sort: byId,
      limit: 10,
      cursor: { id: OID, value: null },
      before: [search],
      after: [lookup],
    });
    expect(pipeline).toEqual([
      search,
      { $match: { $and: [{ status: "A" }, { _id: { $gt: id } }] } },
      { $sort: { _id: 1 } },
      { $limit: 11 },
      lookup,
    ]);
  });

  test("empty match with cursor does not produce an empty $and", () => {
    const [match] = buildPaginatedPipeline({ match: {}, sort: byId, limit: 1, cursor: { id: OID, value: null } });
    expect(match).toEqual({ $match: { _id: { $gt: id } } });
  });
});

describe("toPage", () => {
  const rows = [
    { _id: OID, name: "a" },
    { _id: OID2, name: "b" },
    { _id: OID, name: "c" },
  ];

  test("more when an extra row came back; token points at the last row of the page", () => {
    const page = toPage(rows, 2, "name", 7);
    expect(page.more).toBe(true);
    expect(page.count).toBe(7);
    expect(page.payload).toEqual(rows.slice(0, 2));
    expect(decodeCursor(page.paginationToken!, "string")).toEqual({ id: OID2, value: "b" });
  });

  test("no more when the page is not full", () => {
    const page = toPage(rows, 3, "name");
    expect(page.more).toBe(false);
    expect(page.count).toBe(-1);
    expect(page.payload).toEqual(rows);
    expect(decodeCursor(page.paginationToken!, "string")).toEqual({ id: OID, value: "c" });
  });

  test("empty result", () => {
    expect(toPage([], 10, "name")).toEqual({ count: -1, more: false, paginationToken: null, payload: [] });
  });
});

describe("paginate", () => {
  const rows = [
    { _id: OID, name: "a" },
    { _id: OID2, name: "b" },
  ];

  const fakeCollection = () => ({
    aggregate: vi.fn(async (pipeline: unknown[]) =>
      pipeline.some((s) => typeof s === "object" && s !== null && "$count" in s) ? [{ count: 9 }] : rows
    ),
    countDocuments: vi.fn(async () => 9),
  });

  test("counts with countDocuments when there is no search stage", async () => {
    const collection = fakeCollection();
    const page = await paginate<(typeof rows)[number]>({
      collection,
      match: { status: "A" },
      sort: asc,
      limit: 1,
      cursor: null,
    });
    expect(collection.countDocuments).toHaveBeenCalledWith({ status: "A" }, { session: undefined });
    expect(collection.aggregate).toHaveBeenCalledTimes(1);
    expect(page).toEqual({
      count: 9,
      more: true,
      paginationToken: encodeCursor({ id: OID, value: "a" }),
      payload: [rows[0]],
    });
  });

  test("counts through the search stage when present", async () => {
    const collection = fakeCollection();
    const search = { $search: { index: "i" } } as never;
    await paginate({ collection, match: { status: "A" }, sort: asc, limit: 5, cursor: null, before: [search] });
    expect(collection.countDocuments).not.toHaveBeenCalled();
    expect(collection.aggregate).toHaveBeenCalledWith([search, { $match: { status: "A" } }, { $count: "count" }], {
      session: undefined,
    });
  });

  test("skips the count on request", async () => {
    const collection = fakeCollection();
    const page = await paginate({ collection, match: {}, sort: asc, limit: 5, cursor: null, count: false });
    expect(collection.countDocuments).not.toHaveBeenCalled();
    expect(page.count).toBe(-1);
    expect(page.more).toBe(false);
  });

  test("passes the session through", async () => {
    const collection = fakeCollection();
    const session = { id: "s" } as never;
    await paginate({ collection, match: {}, sort: asc, limit: 5, cursor: null, session });
    expect(collection.aggregate).toHaveBeenCalledWith(expect.any(Array), { session });
    expect(collection.countDocuments).toHaveBeenCalledWith({}, { session });
  });
});
