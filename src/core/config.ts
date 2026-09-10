export type FieldType = "string" | "number" | "boolean" | "date";

export interface FieldConfig {
  /** Document path the public key maps to, e.g. `entities.id`. */
  path: string;
  type: FieldType;
  filter: boolean;
  sort: boolean;
}

/**
 * Everything a route allows. Plain data, so it can be exported to a client and drive the same
 * validation there. Build one with `defineQueryConfig`, or derive it from a schema via `/typegoose` or `/zod`.
 */
export interface QueryConfig {
  /** Maximum and default page size. */
  limit: number;
  /** Public key (as used in the URL) to field configuration. */
  fields: Record<string, FieldConfig>;
  /** Free-text search index name for server adapters; `{database}` is replaced by the adapter. */
  searchIndex?: string;
}

export interface FieldInput {
  path?: string;
  type: FieldType;
  filter?: boolean;
  sort?: boolean;
}

export interface QueryConfigInput {
  limit?: number;
  searchIndex?: string;
  fields: Record<string, FieldInput>;
}

export const DEFAULT_LIMIT = 50;

export const ID_FIELD: FieldConfig = { path: "_id", type: "string", filter: false, sort: true };

export function toFieldConfig(key: string, field: FieldInput): FieldConfig {
  return { path: field.path ?? key, type: field.type, filter: field.filter ?? true, sort: field.sort ?? false };
}

/** Builds a config by hand. `_id` is always sortable unless overridden. */
export function defineQueryConfig(input: QueryConfigInput): QueryConfig {
  const fields: Record<string, FieldConfig> = { _id: ID_FIELD };
  for (const [key, field] of Object.entries(input.fields)) {
    fields[key] = toFieldConfig(key, field);
  }
  return { limit: input.limit ?? DEFAULT_LIMIT, searchIndex: input.searchIndex, fields };
}

export function getField(config: QueryConfig, key: string): FieldConfig | undefined {
  return Object.prototype.hasOwnProperty.call(config.fields, key) ? config.fields[key] : undefined;
}

export function filterableKeys(config: QueryConfig): string[] {
  return Object.keys(config.fields).filter((key) => config.fields[key].filter);
}

export function sortableKeys(config: QueryConfig): string[] {
  return Object.keys(config.fields).filter((key) => config.fields[key].sort);
}
