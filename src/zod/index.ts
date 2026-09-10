import { DEFAULT_LIMIT, FieldConfig, FieldInput, FieldType, ID_FIELD, QueryConfig, toFieldConfig } from "../core/config";

/**
 * Minimal structural view of a zod v4 (and v3-compatible) object schema, so this entry point
 * works without importing zod. Only `shape` and each field's `def.type` chain are read.
 */
export interface ZodLike {
  readonly shape?: Readonly<Record<string, ZodLike>>;
  readonly def?: ZodDef;
  readonly _def?: ZodDef;
  readonly _zod?: { readonly def: ZodDef };
}

interface ZodDef {
  readonly type?: string;
  readonly typeName?: string;
  readonly innerType?: ZodLike;
  readonly element?: ZodLike;
  readonly in?: ZodLike;
  readonly schema?: ZodLike;
  readonly options?: readonly ZodLike[];
}

export interface ZodConfigOptions {
  limit?: number;
  searchIndex?: string;
  /** Keys that may be sorted on. Defaults to none besides `_id`. */
  sort?: string[];
  /** Keys that may be filtered on. Defaults to every field with a supported type. */
  filter?: string[];
  /** Maps a schema key to a different document path. */
  paths?: Record<string, string>;
  /** Extra or overriding fields. */
  fields?: Record<string, FieldInput>;
}

const V4_TYPES: Record<string, FieldType> = { string: "string", number: "number", int: "number", boolean: "boolean", date: "date", enum: "string", literal: "string" };
const V3_TYPES: Record<string, FieldType> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodDate: "date",
  ZodEnum: "string",
  ZodNativeEnum: "string",
  ZodLiteral: "string",
};

function defOf(schema: ZodLike): ZodDef | undefined {
  return schema._zod?.def ?? schema.def ?? schema._def;
}

/** Resolves a zod field to a monquery type, unwrapping optional/nullable/default/array/pipe wrappers. */
export function fieldTypeOf(schema: ZodLike, depth = 0): FieldType | undefined {
  if (depth > 10) return undefined;
  const def = defOf(schema);
  if (!def) return undefined;

  const name = def.type ?? def.typeName ?? "";
  const direct = V4_TYPES[name] ?? V3_TYPES[name];
  if (direct) return direct;

  const inner = def.innerType ?? def.element ?? def.in ?? def.schema;
  if (inner) return fieldTypeOf(inner, depth + 1);

  if (def.options?.length) {
    const types = new Set(def.options.map((o) => fieldTypeOf(o, depth + 1)));
    return types.size === 1 ? [...types][0] : undefined;
  }
  return undefined;
}

/**
 * Derives a config from a zod object schema. Fields whose type cannot be mapped (objects, unions of
 * mixed types, records) are skipped; add them via `fields` if they map to a scalar path.
 */
export function fromZod(schema: ZodLike, options: ZodConfigOptions = {}): QueryConfig {
  const { limit = DEFAULT_LIMIT, searchIndex, sort = [], filter, paths = {}, fields: extra = {} } = options;
  const shape = schema.shape ?? {};
  const fields: Record<string, FieldConfig> = { _id: ID_FIELD };

  for (const [key, field] of Object.entries(shape)) {
    const type = fieldTypeOf(field);
    if (!type) continue;
    fields[key] = {
      path: paths[key] ?? key,
      type,
      filter: filter ? filter.includes(key) : true,
      sort: sort.includes(key),
    };
  }

  for (const [key, field] of Object.entries(extra)) {
    fields[key] = toFieldConfig(key, field);
  }

  return { limit, searchIndex, fields };
}
