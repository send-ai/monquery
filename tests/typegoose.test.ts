import { PropType, prop } from "@typegoose/typegoose";
import { describe, expect, test } from "vitest";

import { filterableKeys, getField, sortableKeys } from "../src/core/config";
import { createQueryConfig } from "../src/typegoose/index";

class Entity {
  @prop({ type: () => String, filter: true })
  id!: string;

  @prop({ type: () => String })
  label!: string;
}

class Settings {
  @prop({ type: () => Boolean, filter: true, sort: true })
  enabled!: boolean;

  @prop({ type: () => Settings, filter: true })
  nested?: Settings;

  @prop({ type: () => Settings })
  ignored?: Settings;
}

class Referenced {
  @prop({ type: () => String, filter: true })
  code!: string;
}

class Sample {
  @prop({ type: () => String, required: true, filter: true })
  sample_id!: string;

  @prop({ type: () => String, filter: true, sort: true })
  name!: string;

  @prop({ type: () => Number, sort: true })
  count!: number;

  @prop({ type: () => Date, filter: true, sort: true })
  created_at!: Date;

  @prop({ type: () => Boolean })
  hidden!: boolean;

  @prop({ type: () => [String], filter: true }, PropType.ARRAY)
  tags!: string[];

  @prop({ type: () => Entity, filter: true }, PropType.ARRAY)
  entities!: Entity[];

  @prop({ type: () => Settings, filter: true })
  settings!: Settings;

  @prop({ ref: () => Referenced })
  referenced!: Referenced;

  @prop({ type: () => Object, filter: true })
  blob!: Record<string, unknown>;
}

describe("createQueryConfig (typegoose)", () => {
  const config = createQueryConfig(Sample, {
    limit: 100,
    alias: { "entities.id": "entity_ids" },
    searchIndex: "idx-{database}",
  });

  test("carries options", () => {
    expect(config.limit).toBe(100);
    expect(config.searchIndex).toBe("idx-{database}");
  });

  test("scalar props with filter/sort flags", () => {
    expect(config.fields.sample_id).toEqual({ path: "sample_id", type: "string", filter: true, sort: false });
    expect(config.fields.name).toEqual({ path: "name", type: "string", filter: true, sort: true });
    expect(config.fields.count).toEqual({ path: "count", type: "number", filter: false, sort: true });
    expect(config.fields.created_at).toEqual({ path: "created_at", type: "date", filter: true, sort: true });
  });

  test("props without flags are excluded", () => {
    expect(config.fields.hidden).toBeUndefined();
    expect(config.fields["entities.label"]).toBeUndefined();
  });

  test("arrays of scalars use the element type", () => {
    expect(config.fields.tags).toEqual({ path: "tags", type: "string", filter: true, sort: false });
  });

  test("arrays of classes and nested classes are walked, with aliases applied", () => {
    expect(config.fields.entity_ids).toEqual({ path: "entities.id", type: "string", filter: true, sort: false });
    expect(config.fields["settings.enabled"]).toEqual({ path: "settings.enabled", type: "boolean", filter: true, sort: true });
  });

  test("nested classes are only walked when their prop opts in, and self-references stop", () => {
    expect(config.fields["settings.nested.enabled"]).toBeDefined();
    expect(config.fields["settings.ignored.enabled"]).toBeUndefined();
    expect(config.fields["settings.nested.nested.enabled"]).toBeUndefined();
  });

  test("refs are walked like nested classes", () => {
    expect(config.fields["referenced.code"]).toEqual({ path: "referenced.code", type: "string", filter: true, sort: false });
  });

  test("plain Object props are not walked", () => {
    expect(Object.keys(config.fields).some((k) => k.startsWith("blob"))).toBe(false);
  });

  test("_id is sortable; extra fields override and extend", () => {
    expect(config.fields._id).toEqual({ path: "_id", type: "string", filter: false, sort: true });
    const extended = createQueryConfig(Sample, {
      fields: { count: { type: "number", filter: true, sort: true }, virtual: { type: "string", path: "meta.virtual" } },
    });
    expect(extended.fields.count).toEqual({ path: "count", type: "number", filter: true, sort: true });
    expect(extended.fields.virtual).toEqual({ path: "meta.virtual", type: "string", filter: true, sort: false });
  });

  test("custom flag names", () => {
    class Flagged {
      @prop({ type: () => String, queryable: true })
      code!: string;
    }
    const custom = createQueryConfig(Flagged, { flags: { filter: "queryable" } });
    expect(custom.fields.code).toEqual({ path: "code", type: "string", filter: true, sort: false });
  });

  test("helpers", () => {
    expect(filterableKeys(config)).toEqual([
      "sample_id",
      "name",
      "created_at",
      "tags",
      "entity_ids",
      "settings.enabled",
      "settings.nested.enabled",
      "referenced.code",
    ]);
    expect(sortableKeys(config)).toEqual(["_id", "name", "count", "created_at", "settings.enabled", "settings.nested.enabled"]);
    expect(getField(config, "toString")).toBeUndefined();
    expect(getField(config, "__proto__")).toBeUndefined();
  });

  test("a class without typegoose metadata yields only _id", () => {
    class Plain {}
    expect(Object.keys(createQueryConfig(Plain).fields)).toEqual(["_id"]);
  });
});
