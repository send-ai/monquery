import { describe, expect, test } from "vitest";
import { z } from "zod";

import { checkFilter } from "../src/core/check";
import { parseFilter } from "../src/core/parser";
import { fieldTypeOf, fromZod } from "../src/zod/index";

const Task = z.object({
  id: z.string(),
  title: z.string().optional(),
  count: z.number().int().nullable(),
  reported: z.boolean().default(false),
  created_at: z.coerce.date(),
  status: z.enum(["OPEN", "DONE"]),
  tags: z.array(z.string()),
  meta: z.object({ a: z.string() }),
  mixed: z.union([z.string(), z.number()]),
  kind: z.literal("task"),
});

describe("fromZod", () => {
  const config = fromZod(Task, { limit: 25, sort: ["created_at", "count"], paths: { title: "name" } });

  test("maps scalar, wrapped, enum, literal and array-of-scalar fields", () => {
    expect(config.limit).toBe(25);
    expect(config.fields.id).toEqual({ path: "id", type: "string", filter: true, sort: false });
    expect(config.fields.title).toEqual({ path: "name", type: "string", filter: true, sort: false });
    expect(config.fields.count).toEqual({ path: "count", type: "number", filter: true, sort: true });
    expect(config.fields.reported).toMatchObject({ type: "boolean" });
    expect(config.fields.created_at).toEqual({ path: "created_at", type: "date", filter: true, sort: true });
    expect(config.fields.status).toMatchObject({ type: "string" });
    expect(config.fields.tags).toMatchObject({ type: "string" });
    expect(config.fields.kind).toMatchObject({ type: "string" });
  });

  test("skips fields it cannot type", () => {
    expect(config.fields.meta).toBeUndefined();
    expect(config.fields.mixed).toBeUndefined();
  });

  test("filter allowlist and extra fields", () => {
    const narrow = fromZod(Task, { filter: ["id"], fields: { rank: { type: "number", path: "meta.rank", sort: true } } });
    expect(narrow.fields.id.filter).toBe(true);
    expect(narrow.fields.title.filter).toBe(false);
    expect(narrow.fields.rank).toEqual({ path: "meta.rank", type: "number", filter: true, sort: true });
  });

  test("the derived config drives checkFilter exactly like a hand-written one", () => {
    expect(checkFilter(parseFilter("title contains 'x' and count gt 5"), config)).toMatchObject({
      type: "and",
      nodes: [{ path: "name", kind: "pattern" }, { path: "count", kind: "value", value: 5 }],
    });
    expect(() => checkFilter(parseFilter("meta eq 1"), config)).toThrow(/not allowed to filter on 'meta'/);
  });

  test("fieldTypeOf unwraps deeply", () => {
    expect(fieldTypeOf(z.array(z.string().optional()).nullable().default([]))).toBe("string");
    expect(fieldTypeOf(z.union([z.literal("a"), z.literal("b")]))).toBe("string");
    expect(fieldTypeOf(z.object({}))).toBeUndefined();
  });
});
