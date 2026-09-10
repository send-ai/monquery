import { DEFAULT_LIMIT, FieldConfig, FieldInput, FieldType, ID_FIELD, QueryConfig, toFieldConfig } from "../core/config";

/**
 * Structural view of a mongoose `Schema`, so this entry point compiles without mongoose and
 * works across mongoose versions. Only `paths`, each path's `instance`, `options`, `schema`
 * and array element type are read.
 */
export interface MongooseSchemaLike {
  readonly paths: Readonly<Record<string, MongoosePathLike>>;
}

export interface MongoosePathLike {
  readonly instance?: string;
  readonly options?: { readonly type?: unknown; readonly [flag: string]: unknown };
  readonly schema?: MongooseSchemaLike;
  readonly caster?: { readonly instance?: string };
  readonly $embeddedSchemaType?: { readonly instance?: string };
}

export interface MongooseConfigOptions {
  limit?: number;
  searchIndex?: string;
  /**
   * Keys that may be filtered. `true` exposes every scalar path; an array lists them explicitly.
   * When omitted, paths opt in through the `filter: true` schema option, like the typegoose adapter.
   */
  filter?: true | string[];
  /** Same as `filter`, for sorting (`sort: true` schema option when omitted). */
  sort?: true | string[];
  /** Maps a document path to the public key, e.g. `{ "entities.id": "entity_ids" }`. */
  alias?: Record<string, string>;
  /** Extra or overriding fields that are not derivable from the schema. */
  fields?: Record<string, FieldInput>;
  /** Schema option names that mark a path. Defaults to `filter` and `sort`. */
  flags?: { filter?: string; sort?: string };
}

const INSTANCE_TYPES: Record<string, FieldType> = { String: "string", Number: "number", Boolean: "boolean", Date: "date" };
const CONSTRUCTOR_TYPES = new Map<unknown, FieldType>([
  [String, "string"],
  [Number, "number"],
  [Boolean, "boolean"],
  [Date, "date"],
]);

const MAX_DEPTH = 8;

/**
 * Derives a config from a plain mongoose schema. Nested objects appear as dotted paths, arrays of
 * scalars use the element type, and subdocument schemas are walked with their path as prefix.
 */
export function fromMongooseSchema(schema: MongooseSchemaLike, options: MongooseConfigOptions = {}): QueryConfig {
  const { limit = DEFAULT_LIMIT, searchIndex, filter, sort, alias = {}, fields: extra = {}, flags = {} } = options;
  const filterFlag = flags.filter ?? "filter";
  const sortFlag = flags.sort ?? "sort";
  const fields: Record<string, FieldConfig> = { _id: ID_FIELD };

  const allowed = (rule: true | string[] | undefined, flag: string, path: string, opts: MongoosePathLike["options"]) => {
    if (rule === true) return true;
    if (Array.isArray(rule)) return rule.includes(path);
    return opts?.[flag] === true;
  };

  walk(schema, null, 0, (path, type, opts) => {
    const canFilter = allowed(filter, filterFlag, path, opts);
    const canSort = allowed(sort, sortFlag, path, opts);
    if (!canFilter && !canSort) return;
    const key = alias[path] ?? path;
    fields[key] = { path, type, filter: canFilter, sort: canSort };
  });

  for (const [key, field] of Object.entries(extra)) {
    fields[key] = toFieldConfig(key, field);
  }

  return { limit, searchIndex, fields };
}

function walk(
  schema: MongooseSchemaLike,
  basePath: string | null,
  depth: number,
  visit: (path: string, type: FieldType, options: MongoosePathLike["options"]) => void
): void {
  if (depth > MAX_DEPTH) return;

  for (const [name, path] of Object.entries(schema.paths)) {
    if (name === "_id" || name === "__v") continue;
    const fullPath = basePath ? `${basePath}.${name}` : name;

    if (path.schema) {
      walk(path.schema, fullPath, depth + 1, visit);
      continue;
    }

    const type = scalarType(path);
    if (type) visit(fullPath, type, { ...elementOptions(path), ...path.options });
  }
}

/** For `field: [{ type: Number, filter: true }]` mongoose keeps the flags on the element, not the array path. */
function elementOptions(path: MongoosePathLike): Record<string, unknown> {
  const declared = Array.isArray(path.options?.type) ? path.options?.type[0] : undefined;
  return declared && typeof declared === "object" && !Array.isArray(declared) && "type" in declared
    ? (declared as Record<string, unknown>)
    : {};
}

/** Scalar type of a path, looking through arrays to their element type. */
export function scalarType(path: MongoosePathLike): FieldType | undefined {
  const direct = path.instance ? INSTANCE_TYPES[path.instance] : undefined;
  if (direct) return direct;
  if (path.instance !== "Array") return undefined;

  const element = path.$embeddedSchemaType?.instance ?? path.caster?.instance;
  if (element && INSTANCE_TYPES[element]) return INSTANCE_TYPES[element];

  const declared = Array.isArray(path.options?.type) ? path.options?.type[0] : undefined;
  const ctor = declared && typeof declared === "object" && "type" in declared ? (declared as { type: unknown }).type : declared;
  return CONSTRUCTOR_TYPES.get(ctor);
}
