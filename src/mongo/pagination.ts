import { ObjectId } from "mongodb";

import { SortSpec, sortStage } from "../core/sort";
import { MongoFilter } from "./compile";
import { Cursor, cursorFromDocument, encodeCursor } from "./token";

import type { ClientSession, Document } from "mongodb";

/** Joins filters with `$and`, dropping empty ones. Never spreads, so `$or` keys from different sources cannot collide. */
export function combineQueries(...queries: (MongoFilter | null | undefined)[]): MongoFilter {
  const present = queries.filter((q): q is MongoFilter => !!q && Object.keys(q).length > 0);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { $and: present };
}

const NULLISH = (path: string): MongoFilter => ({ $or: [{ [path]: null }, { [path]: { $exists: false } }] });

/**
 * Keyset condition selecting everything after `cursor` in the order defined by `sort`.
 * Mongo orders null and missing values before everything else ascending (so after everything descending);
 * the null branches below follow that rule so no document is skipped or repeated across pages.
 */
export function cursorMatch(cursor: Cursor | null, sort: SortSpec): MongoFilter | null {
  if (!cursor) return null;
  const id = new ObjectId(cursor.id);
  const op = sort.direction < 0 ? "$lt" : "$gt";
  const { path } = sort;

  if (path === "_id") return { _id: { [op]: id } };

  if (cursor.value === null) {
    const sameNullBucket = { ...NULLISH(path), _id: { [op]: id } };
    return sort.direction < 0 ? sameNullBucket : { $or: [sameNullBucket, { [path]: { $ne: null } }] };
  }

  const branches: MongoFilter[] = [{ [path]: { [op]: cursor.value } }, { [path]: cursor.value, _id: { [op]: id } }];
  if (sort.direction < 0) branches.push(NULLISH(path));
  return { $or: branches };
}

export interface PipelineInput {
  match: MongoFilter;
  sort: SortSpec;
  limit: number;
  cursor: Cursor | null;
  /** Stages that must run before `$match`, such as a `$text` match or an Atlas `$search` stage. */
  before?: Document[];
  /** Stages after `$limit`, such as `$lookup`s that should only run on the page. */
  after?: Document[];
}

/** The page pipeline. Fetches `limit + 1` rows so `more` is known without a second query. */
export function buildPaginatedPipeline(input: PipelineInput): Document[] {
  const { match, sort, limit, cursor, before = [], after = [] } = input;
  return [
    ...before,
    { $match: combineQueries(match, cursorMatch(cursor, sort)) },
    { $sort: sortStage(sort) },
    { $limit: limit + 1 },
    ...after,
  ];
}

export interface Page<T> {
  count: number;
  more: boolean;
  paginationToken: string | null;
  payload: T[];
}

/** Splits a `limit + 1` result into a page and derives the token for the next one. */
export function toPage<T extends object>(rows: T[], limit: number, sortPath: string, count = -1): Page<T> {
  const more = rows.length > limit;
  const payload = more ? rows.slice(0, limit) : rows;
  const cursor = cursorFromDocument(payload.at(-1) as Record<string, unknown> | undefined, sortPath);
  return { count, more, paginationToken: cursor ? encodeCursor(cursor) : null, payload };
}

type Rows = PromiseLike<unknown[]> | { toArray(): Promise<unknown[]> };

/**
 * The subset of a collection used here. A mongoose `Model` (thenable `aggregate`) and a driver
 * `Collection` (`aggregate().toArray()`) both satisfy it.
 */
export interface PaginatableCollection {
  aggregate(pipeline: Document[], options?: { session?: ClientSession }): Rows;
  countDocuments(filter: MongoFilter, options?: { session?: ClientSession }): PromiseLike<number>;
}

async function rows(result: Rows): Promise<unknown[]> {
  return "toArray" in result ? result.toArray() : result;
}

export interface PaginateInput extends PipelineInput {
  collection: PaginatableCollection;
  session?: ClientSession | null;
  /** Skip the count query and report -1. */
  count?: boolean;
}

/** Runs a paginated aggregation plus, by default, a count of the whole result set. */
export async function paginate<T extends object>(input: PaginateInput): Promise<Page<T>> {
  const { collection, session, count: includeCount = true, ...pipelineInput } = input;
  const opts = { session: session ?? undefined };

  const [data, count] = await Promise.all([
    rows(collection.aggregate(buildPaginatedPipeline(pipelineInput), opts)),
    includeCount ? countAll(collection, pipelineInput, opts) : Promise.resolve(-1),
  ]);

  return toPage(data as T[], pipelineInput.limit, pipelineInput.sort.path, count);
}

async function countAll(
  collection: PaginatableCollection,
  input: PipelineInput,
  opts: { session?: ClientSession }
): Promise<number> {
  const before = input.before ?? [];
  if (before.length === 0) return await collection.countDocuments(input.match, opts);

  const result = (await rows(collection.aggregate([...before, { $match: input.match }, { $count: "count" }], opts))) as {
    count?: number;
  }[];
  return result[0]?.count ?? 0;
}
