import { QueryConfig } from "../core/config";
import { MonqueryError } from "../core/errors";
import { ParsedQuery } from "../core/query";
import { MongoFilter, toMongo } from "./compile";
import { TextSearch, atlasSearchStage, textSearch } from "./search";
import { Cursor, decodeCursor } from "./token";

import type { Document } from "mongodb";

export { toMongo } from "./compile";
export type { MongoFilter } from "./compile";
export { buildPaginatedPipeline, combineQueries, cursorMatch, paginate, toPage } from "./pagination";
export type { Page, PaginatableCollection, PaginateInput, PipelineInput } from "./pagination";
export { atlasSearchStage, escapeWildcard, textSearch } from "./search";
export type { TextSearch } from "./search";
export { cursorFromDocument, decodeCursor, encodeCursor } from "./token";
export type { Cursor, CursorValue } from "./token";

/** Everything a Mongo-backed handler needs, derived from a database-free `ParsedQuery`. */
export interface MongoQuery extends ParsedQuery {
  /** Compiled `filter=`; `{}` when absent. */
  match: MongoFilter;
  cursor: Cursor | null;
  /** `$text` match for `q`, when the config has no `searchIndex`. Put it first in the pipeline. */
  search: TextSearch | null;
  /** Atlas `$search` stage for `q`, when the config has a `searchIndex`. Put it first in the pipeline. */
  searchStage: Document | null;
  /** `search` and `searchStage` as ready-made leading stages for `paginate({ before })`. */
  before: Document[];
}

export interface ToMongoQueryOptions {
  /** Replaces `{database}` in `config.searchIndex`. Required when `q` is used with an Atlas index. */
  databaseId?: string;
}

/** Turns a `ParsedQuery` into Mongo pieces: compiled match, decoded cursor and the search stage. */
export function toMongoQuery(parsed: ParsedQuery, config: QueryConfig, options: ToMongoQueryOptions = {}): MongoQuery {
  const match = toMongo(parsed.filter);
  const cursor = parsed.token ? decodeCursor(parsed.token, parsed.sort.type) : null;

  let search: TextSearch | null = null;
  let searchStage: Document | null = null;
  if (config.searchIndex) {
    if (parsed.q && options.databaseId === undefined) {
      throw new MonqueryError("unsupported", "Search is not available on this route");
    }
    searchStage = atlasSearchStage(parsed.q, config.searchIndex, options.databaseId ?? "");
  } else {
    search = textSearch(parsed.q);
  }

  const before: Document[] = [];
  if (search) before.push({ $match: search });
  if (searchStage) before.push(searchStage);

  return { ...parsed, match, cursor, search, searchStage, before };
}
