import { Schema } from "mongoose";
import { describe, expect, test } from "vitest";

import { checkFilter } from "../src/core/check";
import { filterableKeys, sortableKeys } from "../src/core/config";
import { parseFilter } from "../src/core/parser";
import { fromMongooseSchema } from "../src/mongoose/index";

const Item = new Schema({ id: { type: String, filter: true }, qty: Number });
const Settings = new Schema({ enabled: { type: Boolean, filter: true, sort: true } });

const Sample = new Schema({
  sample_id: { type: String, filter: true },
  name: { type: String, filter: true, sort: true },
  count: { type: Number, sort: true },
  created_at: { type: Date, filter: true, sort: true },
  hidden: Boolean,
  tags: { type: [String], filter: true },
  scores: [{ type: Number, filter: true }],
  items: [Item],
  settings: Settings,
  address: { city: { type: String, filter: true }, zip: String },
  owner: { type: Schema.Types.ObjectId, ref: "User", filter: true },
  blob: { type: Schema.Types.Mixed, filter: true },
});

describe("fromMongooseSchema", () => {
  test("opt-in through schema options, like typegoose", () => {
    const config = fromMongooseSchema(Sample, { limit: 100, alias: { "items.id": "item_ids" } });
    expect(config.limit).toBe(100);
    expect(config.fields.sample_id).toEqual({ path: "sample_id", type: "string", filter: true, sort: false });
    expect(config.fields.name).toEqual({ path: "name", type: "string", filter: true, sort: true });
    expect(config.fields.count).toEqual({ path: "count", type: "number", filter: false, sort: true });
    expect(config.fields.created_at).toMatchObject({ type: "date", filter: true, sort: true });
    expect(config.fields.hidden).toBeUndefined();
  });

  test("arrays of scalars, subdocument arrays, nested schemas and nested objects", () => {
    const config = fromMongooseSchema(Sample, { alias: { "items.id": "item_ids" } });
    expect(config.fields.tags).toEqual({ path: "tags", type: "string", filter: true, sort: false });
    expect(config.fields.scores).toEqual({ path: "scores", type: "number", filter: true, sort: false });
    expect(config.fields.item_ids).toEqual({ path: "items.id", type: "string", filter: true, sort: false });
    expect(config.fields["items.qty"]).toBeUndefined();
    expect(config.fields["settings.enabled"]).toEqual({ path: "settings.enabled", type: "boolean", filter: true, sort: true });
    expect(config.fields["address.city"]).toEqual({ path: "address.city", type: "string", filter: true, sort: false });
    expect(config.fields["address.zip"]).toBeUndefined();
  });

  test("ObjectId and Mixed paths are skipped even when flagged", () => {
    const config = fromMongooseSchema(Sample);
    expect(config.fields.owner).toBeUndefined();
    expect(config.fields.blob).toBeUndefined();
  });

  test("explicit allowlists override the flags", () => {
    const config = fromMongooseSchema(Sample, { filter: ["hidden", "count"], sort: ["hidden"] });
    expect(config.fields.hidden).toEqual({ path: "hidden", type: "boolean", filter: true, sort: true });
    expect(config.fields.count).toEqual({ path: "count", type: "number", filter: true, sort: false });
    expect(config.fields.name).toBeUndefined();
  });

  test("filter: true exposes every scalar path", () => {
    const config = fromMongooseSchema(Sample, { filter: true });
    expect(filterableKeys(config)).toEqual([
      "sample_id",
      "name",
      "count",
      "created_at",
      "hidden",
      "tags",
      "scores",
      "items.id",
      "items.qty",
      "settings.enabled",
      "address.city",
      "address.zip",
    ]);
    expect(sortableKeys(config)).toEqual(["_id", "name", "count", "created_at", "settings.enabled"]);
  });

  test("custom flag names and extra fields", () => {
    const Flagged = new Schema({ code: { type: String, queryable: true } });
    const config = fromMongooseSchema(Flagged, {
      flags: { filter: "queryable" },
      fields: { rank: { type: "number", path: "meta.rank", sort: true } },
    });
    expect(config.fields.code).toEqual({ path: "code", type: "string", filter: true, sort: false });
    expect(config.fields.rank).toEqual({ path: "meta.rank", type: "number", filter: true, sort: true });
  });

  test("the derived config drives checkFilter", () => {
    const config = fromMongooseSchema(Sample, { alias: { "items.id": "item_ids" } });
    expect(checkFilter(parseFilter("item_ids in a,b and created_at gt 2024-01-01"), config)).toMatchObject({
      type: "and",
      nodes: [{ path: "items.id", kind: "list" }, { path: "created_at", kind: "value" }],
    });
    expect(() => checkFilter(parseFilter("hidden eq true"), config)).toThrow(/not allowed to filter on 'hidden'/);
  });
});
