import { describe, expect, test, vi } from "vitest";

import { defineQueryConfig } from "../src/core/config";
import { MonqueryError } from "../src/core/errors";
import { monqueryMiddleware, requireMonquery } from "../src/express/index";

import type { MonqueryRequest } from "../src/express/index";

import { config } from "./fixtures";

type Req = MonqueryRequest & { database?: { id: string } };

describe("monqueryMiddleware", () => {
  const run = (query: unknown, database?: { id: string }) => {
    const req: Req = { query, database };
    const next = vi.fn();
    monqueryMiddleware<Req>(config, { databaseId: (r) => r.database?.id })(req, {}, next);
    return { req, next };
  };

  test("attaches req.monquery and calls next()", () => {
    const { req, next } = run({ filter: "status eq A" });
    expect(next).toHaveBeenCalledWith();
    expect(req.monquery).toMatchObject({ match: { status: { $eq: "A" } }, limit: 50 });
    expect(requireMonquery(req)).toBe(req.monquery);
  });

  test("forwards MonqueryError to next(err)", () => {
    const { req, next } = run({ filter: "nope eq 1" });
    expect(req.monquery).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(MonqueryError));
    expect((next.mock.calls[0][0] as MonqueryError).status).toBe(400);
  });

  test("resolves the database id for Atlas search", () => {
    const indexed = defineQueryConfig({ searchIndex: "docs-{database}", fields: {} });
    const req: Req = { query: { q: "x" }, database: { id: "db9" } };
    const next = vi.fn();
    monqueryMiddleware<Req>(indexed, { databaseId: (r) => r.database?.id })(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.monquery?.searchStage).toMatchObject({ $search: { index: "docs-db9" } });
  });

  test("requireMonquery throws when the middleware did not run", () => {
    expect(() => requireMonquery({ query: {} })).toThrow(/did not run/);
  });
});
