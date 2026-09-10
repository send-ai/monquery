import "reflect-metadata";

import { DEFAULT_LIMIT, FieldConfig, FieldInput, FieldType, ID_FIELD, QueryConfig, toFieldConfig } from "../core/config";

type Constructor<T = unknown> = new (...args: never[]) => T;

export interface TypegooseConfigOptions {
  limit?: number;
  searchIndex?: string;
  /** Maps a document path to the public key, e.g. `{ "entities.id": "entity_ids" }`. */
  alias?: Record<string, string>;
  /** Extra or overriding fields that are not derivable from the model. */
  fields?: Record<string, FieldInput>;
  /** Prop option names that mark a field. Defaults to `filter` and `sort`. */
  flags?: { filter?: string; sort?: string };
}

interface TypegooseProp {
  key: string;
  target: object;
  options: Record<string, unknown>;
}

const SCALAR_TYPES = new Map<unknown, FieldType>([
  [String, "string"],
  [Number, "number"],
  [Boolean, "boolean"],
  [Date, "date"],
]);

const MAX_DEPTH = 8;

/**
 * Derives a config from a typegoose class: every `@prop({ filter: true })` becomes filterable and
 * every `@prop({ sort: true })` sortable. Nested classes, arrays of classes and refs are walked
 * when their own prop carries a flag.
 */
export function createQueryConfig(model: Constructor, options: TypegooseConfigOptions = {}): QueryConfig {
  const { limit = DEFAULT_LIMIT, searchIndex, alias = {}, fields: extra = {}, flags = {} } = options;
  const filterFlag = flags.filter ?? "filter";
  const sortFlag = flags.sort ?? "sort";
  const fields: Record<string, FieldConfig> = { _id: ID_FIELD };

  walk(model, null, 0, filterFlag, sortFlag, (path, type, prop) => {
    const filter = prop.options[filterFlag] === true;
    const sort = prop.options[sortFlag] === true;
    if (!filter && !sort) return;
    const key = alias[path] ?? path;
    fields[key] = { path, type, filter, sort };
  });

  for (const [key, field] of Object.entries(extra)) {
    fields[key] = toFieldConfig(key, field);
  }

  return { limit, searchIndex, fields };
}

function walk(
  cls: Constructor,
  basePath: string | null,
  depth: number,
  filterFlag: string,
  sortFlag: string,
  visit: (path: string, type: FieldType, prop: TypegooseProp) => void
): void {
  if (depth > MAX_DEPTH) return;
  const props: Map<string, TypegooseProp> | undefined = Reflect.getMetadata("typegoose:properties", cls.prototype);
  if (!props) return;

  for (const prop of props.values()) {
    const path = basePath ? `${basePath}.${prop.key}` : prop.key;
    if (hasRepeatedSegment(path)) continue;

    const ref = resolveType(prop.options.ref);
    if (isConstructor(ref)) {
      walk(ref, path, depth + 1, filterFlag, sortFlag, visit);
      continue;
    }

    const type = resolveType(prop.options.type) ?? Reflect.getMetadata("design:type", prop.target, prop.key);
    const scalar = SCALAR_TYPES.get(type);

    if (scalar) {
      visit(path, scalar, prop);
    } else if (
      isConstructor(type) &&
      type !== Array &&
      type !== Object &&
      (prop.options[filterFlag] || prop.options[sortFlag])
    ) {
      walk(type, path, depth + 1, filterFlag, sortFlag, visit);
    }
  }
}

/** Typegoose accepts `type: () => String`, `type: () => [String]` and plain constructors. Unwraps all of them. */
function resolveType(typeOrFn: unknown): unknown {
  let type = typeOrFn;
  if (typeof type === "function" && !isConstructor(type)) type = (type as () => unknown)();
  let dim = 0;
  while (Array.isArray(type) && dim < 10) {
    type = type[0];
    dim++;
  }
  return type;
}

function isConstructor(value: unknown): value is Constructor {
  return (
    typeof value === "function" &&
    typeof (value as { prototype?: { constructor?: unknown } }).prototype?.constructor === "function"
  );
}

function hasRepeatedSegment(path: string): boolean {
  const parts = path.split(".");
  return new Set(parts).size !== parts.length;
}
