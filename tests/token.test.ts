import { describe, expect, test } from "vitest";

import { MonqueryError } from "../src/core/errors";
import { cursorFromDocument, decodeCursor, encodeCursor } from "../src/mongo/token";

import { OID } from "./fixtures";

const legacy = (id: string, value: string) => Buffer.from(`${id}!${value}`, "utf-8").toString("base64");

describe("encodeCursor / decodeCursor", () => {
  test.each([
    ["string", "Invoice 2024"],
    ["string with separator", "Hi! there"],
    ["string with quotes and unicode", `O'Brien "€" 日本`],
    ["numeric-looking string", "12345"],
    ["date-looking string", "2024-01-01T00:00:00.000Z"],
    ["number", 42.5],
    ["negative number", -1],
    ["boolean", false],
    ["date", new Date("2024-01-02T03:04:05.678Z")],
    ["null", null],
  ])("round-trips a %s value with its type intact", (_label, value) => {
    const token = encodeCursor({ id: OID, value });
    expect(decodeCursor(token, "string")).toEqual({ id: OID, value });
  });

  test("token is URL-safe", () => {
    const token = encodeCursor({ id: OID, value: "a?b&c=d/e+f" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("the sort type does not affect a v2 token", () => {
    const token = encodeCursor({ id: OID, value: "123" });
    expect(decodeCursor(token, "number")).toEqual({ id: OID, value: "123" });
  });

  describe("legacy v1 tokens", () => {
    test("string", () => {
      expect(decodeCursor(legacy(OID, "abc"), "string")).toEqual({ id: OID, value: "abc" });
    });

    test("number", () => {
      expect(decodeCursor(legacy(OID, "42"), "number")).toEqual({ id: OID, value: 42 });
    });

    test("date", () => {
      expect(decodeCursor(legacy(OID, "2024-01-01T00:00:00.000Z"), "date")).toEqual({
        id: OID,
        value: new Date("2024-01-01T00:00:00.000Z"),
      });
    });

    test("boolean", () => {
      expect(decodeCursor(legacy(OID, "true"), "boolean")).toEqual({ id: OID, value: true });
    });

    test("null and undefined", () => {
      expect(decodeCursor(legacy(OID, "null"), "string")).toEqual({ id: OID, value: null });
      expect(decodeCursor(legacy(OID, "undefined"), "date")).toEqual({ id: OID, value: null });
    });

    test("value containing the separator is kept whole", () => {
      expect(decodeCursor(legacy(OID, "Hi! there"), "string")).toEqual({ id: OID, value: "Hi! there" });
    });
  });

  describe("invalid tokens", () => {
    test.each([
      ["garbage", "!!!not base64!!!"],
      ["no separator, not json", Buffer.from("abc").toString("base64")],
      ["bad object id", legacy("nope", "x")],
      ["bad object id in v2", encodeCursor({ id: "nope", value: "x" })],
      ["wrong version", Buffer.from(JSON.stringify({ v: 1, id: OID, t: "s", val: "x" })).toString("base64url")],
      ["unknown type tag", Buffer.from(JSON.stringify({ v: 2, id: OID, t: "x", val: "x" })).toString("base64url")],
      ["type mismatch", Buffer.from(JSON.stringify({ v: 2, id: OID, t: "n", val: "x" })).toString("base64url")],
      ["invalid date", Buffer.from(JSON.stringify({ v: 2, id: OID, t: "d", val: "nope" })).toString("base64url")],
      ["malformed json", Buffer.from("{oops").toString("base64url")],
      ["legacy number that is not numeric", legacy(OID, "abc")],
    ])("%s", (_label, token) => {
      expect(() => decodeCursor(token, "number")).toThrow(MonqueryError);
      expect(() => decodeCursor(token, "number")).toThrow("Pagination token is invalid");
    });
  });
});

describe("cursorFromDocument", () => {
  test("reads _id and the sort value, including nested paths", () => {
    expect(cursorFromDocument({ _id: OID, meta: { rank: 3 } }, "meta.rank")).toEqual({ id: OID, value: 3 });
  });

  test("null for missing document or _id", () => {
    expect(cursorFromDocument(null, "name")).toBeNull();
    expect(cursorFromDocument({}, "name")).toBeNull();
  });

  test("missing sort value becomes null", () => {
    expect(cursorFromDocument({ _id: OID }, "name")).toEqual({ id: OID, value: null });
    expect(cursorFromDocument({ _id: OID, meta: null }, "meta.rank")).toEqual({ id: OID, value: null });
  });

  test("sorting on _id carries no value", () => {
    expect(cursorFromDocument({ _id: OID, name: "x" }, "_id")).toEqual({ id: OID, value: null });
  });

  test("ObjectId-like values stringify", () => {
    const oid = { toString: () => OID };
    expect(cursorFromDocument({ _id: oid, ref: oid }, "ref")).toEqual({ id: OID, value: OID });
  });
});
