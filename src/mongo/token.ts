import { FieldType } from "../core/config";
import { MonqueryError } from "../core/errors";

export type CursorValue = string | number | boolean | Date | null;

/** Keyset position: the `_id` and sort value of the last document on the previous page. */
export interface Cursor {
  id: string;
  value: CursorValue;
}

type Encoded =
  | { v: 2; id: string; t: "null"; val: null }
  | { v: 2; id: string; t: "s"; val: string }
  | { v: 2; id: string; t: "n"; val: number }
  | { v: 2; id: string; t: "b"; val: boolean }
  | { v: 2; id: string; t: "d"; val: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function encodeCursor(cursor: Cursor): string {
  const { id, value } = cursor;
  let encoded: Encoded;
  if (value === null || value === undefined) encoded = { v: 2, id, t: "null", val: null };
  else if (value instanceof Date) encoded = { v: 2, id, t: "d", val: value.toISOString() };
  else if (typeof value === "number") encoded = { v: 2, id, t: "n", val: value };
  else if (typeof value === "boolean") encoded = { v: 2, id, t: "b", val: value };
  else encoded = { v: 2, id, t: "s", val: String(value) };
  return Buffer.from(JSON.stringify(encoded), "utf-8").toString("base64url");
}

/**
 * Decodes a v2 token. Legacy v1 tokens (`<_id>!<value>` in base64) are accepted too, with the value
 * coerced according to `sortType`, so in-flight clients keep paginating across a deploy.
 */
export function decodeCursor(token: string, sortType: FieldType): Cursor {
  let text: string;
  try {
    text = Buffer.from(token, "base64").toString("utf-8");
  } catch {
    throw invalid();
  }

  const cursor = text.startsWith("{") ? decodeV2(text) : decodeLegacy(text, sortType);
  if (!OBJECT_ID.test(cursor.id)) throw invalid();
  return cursor;
}

function decodeV2(text: string): Cursor {
  let parsed: Partial<Encoded>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (parsed.v !== 2 || typeof parsed.id !== "string") throw invalid();

  switch (parsed.t) {
    case "null":
      return { id: parsed.id, value: null };
    case "s":
      if (typeof parsed.val !== "string") throw invalid();
      return { id: parsed.id, value: parsed.val };
    case "n":
      if (typeof parsed.val !== "number" || !Number.isFinite(parsed.val)) throw invalid();
      return { id: parsed.id, value: parsed.val };
    case "b":
      if (typeof parsed.val !== "boolean") throw invalid();
      return { id: parsed.id, value: parsed.val };
    case "d": {
      const date = new Date(typeof parsed.val === "string" ? parsed.val : NaN);
      if (Number.isNaN(date.getTime())) throw invalid();
      return { id: parsed.id, value: date };
    }
    default:
      throw invalid();
  }
}

function decodeLegacy(text: string, sortType: FieldType): Cursor {
  const separator = text.indexOf("!");
  if (separator < 0) throw invalid();
  const id = text.slice(0, separator);
  const raw = text.slice(separator + 1);

  if (raw === "" || raw === "null" || raw === "undefined") return { id, value: null };

  switch (sortType) {
    case "number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw invalid();
      return { id, value };
    }
    case "boolean":
      return { id, value: raw === "true" };
    case "date": {
      const value = new Date(raw);
      if (Number.isNaN(value.getTime())) throw invalid();
      return { id, value };
    }
    default:
      return { id, value: raw };
  }
}

/** Reads a cursor off the last document of a page. Returns null when there is no document. */
export function cursorFromDocument(doc: Record<string, unknown> | null | undefined, sortPath: string): Cursor | null {
  if (!doc || doc._id == null) return null;
  const id = String(doc._id);
  if (sortPath === "_id") return { id, value: null };
  const value = resolvePath(doc, sortPath);
  return { id, value: normalizeValue(value) };
}

function normalizeValue(value: unknown): CursorValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function resolvePath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), doc);
}

function invalid(): MonqueryError {
  return new MonqueryError("invalid_token", "Pagination token is invalid");
}
