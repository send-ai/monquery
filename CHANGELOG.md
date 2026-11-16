# Changelog

## 0.2.0 (2026-11-16)

- **Breaking:** requires Node 22.18 or later (`engines.node` was `>=20`). Node 20 reached end of life in April 2026.

- New `@sendai/monquery/mongoose` entry point: `fromMongooseSchema(schema, options)` derives a config from a plain mongoose `Schema`, opting paths in through `filter: true` / `sort: true` schema options or explicit allowlists.
- README rewritten around the three schema-free and schema-driven ways to build a config.
- Built with TypeScript 6 and tsup 9. The JavaScript output is unchanged; type exports in the declarations are written as `export type { ... }`.
- CI on Node 22 and 24; release workflow with npm provenance.

## 0.1.0

First public release.

- Core grammar: lexer, recursive-descent parser with `and`/`or`/`not` precedence, serializer, `checkFilter` (schema-driven validation and coercion with JSON-safe output), `parseQuery` / `validateQuery`.
- `/client`: `f` builder, `buildQueryString`, facet helpers (`getFacet`, `setFacet`, `removeFacet`).
- `/mongo`: `toMongo`, `toMongoQuery`, keyset `paginate` for mongoose models and driver collections, typed cursor tokens, `$text` and Atlas search stages.
- `/express`: `monqueryMiddleware`, `requireMonquery`.
- `/typegoose`: `createQueryConfig` from `@prop` flags.
- `/zod`: `fromZod` structural adapter.
