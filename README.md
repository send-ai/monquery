# @sendai/monquery

Readable, hand-typeable URL queries that compile to safe MongoDB queries, with the same validation running in the browser and on the server.

```
GET /projects?filter=status eq ACTIVE and (name contains 'invoice' or created_at gt 2024-01-01)&sort=created_at desc&limit=25&token=...
```

One package, several entry points. The root is dependency-free and browser-safe; everything server-side is opt-in.

| Import | Runs in | What it gives you |
| --- | --- | --- |
| `@sendai/monquery` | anywhere | grammar: `parseFilter`, `serializeFilter`, `checkFilter`, `parseQuery`, `validateQuery`, `defineQueryConfig` |
| `@sendai/monquery/client` | anywhere | the root plus builders (`f`), `buildQueryString`, and facet helpers that edit one field of a filter string at a time |
| `@sendai/monquery/mongo` | server | `toMongo`, `toMongoQuery`, keyset `paginate`, cursor tokens, `$text` / Atlas search stages (peer: `mongodb`) |
| `@sendai/monquery/express` | server | `monqueryMiddleware`, `requireMonquery` (no dependency on express itself) |
| `@sendai/monquery/typegoose` | server | `createQueryConfig(Model)` from `@prop({ filter, sort })` flags (peers: `@typegoose/typegoose`, `reflect-metadata`) |
| `@sendai/monquery/zod` | anywhere | `fromZod(schema)` derives a config from a zod object (structural, zod not imported) |

```sh
pnpm add @sendai/monquery
# server extras as needed
pnpm add mongodb            # for /mongo
pnpm add @typegoose/typegoose reflect-metadata   # for /typegoose
```

## The idea in one paragraph

A route declares a `QueryConfig`: which public keys exist, their document path, their type, and whether they may be filtered or sorted. That config is plain data. The server uses it to validate and compile; the same config, shipped to the client, lets the browser reject a bad filter with the identical message before a request is sent, and lets a facet UI know which fields and operators exist. Filters are strings, so they belong in the URL: shareable, hand-editable, and the app can read and write individual facets without losing clauses it does not understand.

## Server

```ts
import { createQueryConfig } from "@sendai/monquery/typegoose";
import { monqueryMiddleware, requireMonquery } from "@sendai/monquery/express";
import { combineQueries, paginate } from "@sendai/monquery/mongo";

const projectQuery = createQueryConfig(Project, { limit: 500, alias: { "entities.id": "entity_ids" } });

router.get("/", monqueryMiddleware(projectQuery, { databaseId: (req) => req.database?.id }), async (req, res, next) => {
  try {
    const { match, sort, limit, cursor, before } = requireMonquery(req);
    const page = await paginate<Project>({
      collection: ProjectDB(req.database.id),
      match: combineQueries(match, { status: "ACTIVE" }), // server-side constraints never collide with the user's $or
      sort,
      limit,
      cursor,
      before, // the $text or Atlas $search stage for q, already in the right place
      after: [{ $lookup: { from: "members", as: "members", localField: "member_ids", foreignField: "user_id" } }],
      session: req.database.session,
    });
    res.send(page); // { count, more, paginationToken, payload }
  } catch (err) {
    next(err);
  }
});
```

Without express: `toMongoQuery(parseQuery(rawQuery, config), config, { databaseId })`.

`paginate` accepts a mongoose `Model` or a driver `Collection`. It fetches `limit + 1` rows so `more` needs no second query and runs the count in parallel (`count: false` skips it and reports `-1`). `buildPaginatedPipeline` and `toPage` are exported for hand-rolled aggregations.

Errors are `MonqueryError` with `status: 400`, a `code` (`syntax`, `unknown_field`, `operator_not_allowed`, `invalid_value`, `invalid_sort`, `invalid_limit`, `invalid_token`, `invalid_query`, `unsupported`) and, for the filter, a character `position`. Map them in your error handler:

```ts
if (isMonqueryError(err)) return res.status(err.status).json({ error: err.message, code: err.code, position: err.position });
```

## Client

```ts
import { f, buildQueryString, validateQuery, getFacet, setFacet, facetValues } from "@sendai/monquery/client";
import type { QueryConfig } from "@sendai/monquery";

// Build safely; every value is quoted and escaped.
const filter = f.and(
  f.eq("project_id", projectId),
  statuses.length > 0 && f.in("process_status", statuses),
  f.contains("name", search),
  f.between("created_at", { from, to }),
  f.isSet("last_opened_at", false)
);
const qs = buildQueryString({ limit: 50, sort: { key: "created_at", direction: "desc" }, q, filter, token });

// Validate a hand-typed filter against the route's config before sending it.
const result = validateQuery({ filter: input }, projectQueryConfig);
if (!result.ok) showError(result.error.message, result.error.position);

// Keep the filter string itself as URL state and edit one facet at a time.
const current = getFacet(url.filter, "process_status"); // Comparison | undefined
facetValues(current); // ["PROCESSING", "REVIEWING"]
const next = setFacet(url.filter, "process_status", f.in("process_status", ["DONE"])); // other clauses untouched
```

Get the config to the client however suits you: export it from the API at build time, serve it from the route, or build both sides from the same zod schema with `fromZod`.

## Grammar

```
filter     := orExpr
orExpr     := andExpr ('or' andExpr)*
andExpr    := unary ('and' unary)*
unary      := 'not' unary | primary
primary    := '(' orExpr ')' | comparison
comparison := key operator values
values     := (value (',' value)*)?
value      := 'quoted string' | bareword
```

- Precedence, tightest first: `not`, `and`, `or`. Brackets override. Nesting up to 32 levels, input up to 4096 characters.
- Keywords and operators are case-insensitive.
- Quoted strings may contain anything; a quote is escaped by doubling it (`'O''Brien'`). Backslashes are literal, so regex escapes like `'\bfoo'` pass through.
- A bareword runs until whitespace, a bracket, a comma or a quote: `ACTIVE`, `prj_123`, `2024-01-01T00:00:00.000Z`, `5`, `true`.
- Bare `null` is the null value; `'null'` is the string.
- Lists are comma-separated: `status in A,B` or `status in 'a b','c,d'`.

Values are typed by the field's declared type, never by their shape. `name eq 5` on a string field matches the string `"5"`.

| Type | Operators |
| --- | --- |
| string | `eq ne in nin all regex inregex ninregex contains startswith endswith exists` |
| number | `eq ne lt lte gt gte in nin all exists` |
| date | `eq ne lt lte gt gte in nin exists` |
| boolean | `eq ne exists` |

`regex` takes a raw pattern, applied case-insensitively, syntax-checked and capped at 512 characters. `contains`, `startswith`, `endswith` take literal text and escape it. `null` works with `eq`, `ne`, `in`, `nin`. Dates accept ISO 8601 only. `not` compiles to `$nor`.

Other parameters: `sort=<key> [asc|desc]` (default `_id asc`, `_id` always sortable), `limit=1..max` (default `max`), `q` (free text: `$text`, or Atlas Search when the config has a `searchIndex`), `token` (opaque cursor from the previous page).

## Pagination token

A base64url JSON document `{ v: 2, id, t, val }` with a type tag, so a string that looks like a number or a date is never mis-coerced. Legacy `<_id>!<value>` tokens are still decoded. The keyset condition follows Mongo's rule that null and missing values sort first ascending and last descending, so pages never skip or repeat documents with unset sort fields.

## Security notes

Keys are resolved through the config, so `$where` and friends cannot be injected. Regex operators are the one place user input reaches the query engine as a pattern; the length cap limits, but does not eliminate, expensive patterns. Only expose `regex`/`inregex`/`ninregex` on routes where that is acceptable; `contains` is safe.

## Development

```sh
pnpm install
pnpm test      # vitest, 195 tests
pnpm check     # tsc
pnpm build     # tsup, ESM + CJS + d.ts for every entry point
```
