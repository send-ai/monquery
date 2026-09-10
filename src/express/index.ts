import { QueryConfig } from "../core/config";
import { parseQuery } from "../core/query";
import { MongoQuery, toMongoQuery } from "../mongo/index";

/**
 * Structural request/response types so this entry point has no dependency on `@types/express`.
 * Augment `Express.Request` in your app with `monquery?: MongoQuery` for typed access.
 */
export interface MonqueryRequest {
  query: unknown;
  monquery?: MongoQuery;
}

export type NextFunction = (err?: unknown) => void;

export interface MonqueryMiddlewareOptions<Req extends MonqueryRequest> {
  /** Resolves the id substituted into `config.searchIndex` (`{database}`) for this request. */
  databaseId?: (req: Req) => string | undefined;
}

/** Express middleware. Sets `req.monquery`; invalid input goes to `next(err)` as a `MonqueryError` (status 400). */
export function monqueryMiddleware<Req extends MonqueryRequest = MonqueryRequest>(
  config: QueryConfig,
  options: MonqueryMiddlewareOptions<Req> = {}
) {
  return (req: Req, _res: unknown, next: NextFunction): void => {
    try {
      const parsed = parseQuery(req.query, config);
      req.monquery = toMongoQuery(parsed, config, { databaseId: options.databaseId?.(req) });
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** For handlers mounted behind `monqueryMiddleware`. A missing value is a wiring bug, not user error. */
export function requireMonquery(req: MonqueryRequest): MongoQuery {
  if (!req.monquery) throw new Error("monqueryMiddleware did not run for this route");
  return req.monquery;
}

export type { MongoQuery } from "../mongo/index";
