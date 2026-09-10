import type { Document } from "mongodb";

export interface TextSearch {
  $text: { $search: string };
}

/** `$text` filter for collections with a text index. Must be the first `$match` of a pipeline. */
export function textSearch(q: string | undefined | null): TextSearch | null {
  const query = q?.trim();
  return query ? { $text: { $search: query } } : null;
}

/** Escapes the characters Atlas wildcard queries treat specially, so user text matches literally. */
export function escapeWildcard(value: string): string {
  return value.replace(/[\\*?]/g, "\\$&");
}

/** Atlas Search `$search` stage; goes in `before` of the pagination pipeline. */
export function atlasSearchStage(q: string | undefined | null, index: string, databaseId: string): Document | null {
  const query = q?.trim();
  if (!query) return null;
  return {
    $search: {
      index: index.replace("{database}", databaseId),
      wildcard: {
        query: `*${escapeWildcard(query)}*`,
        allowAnalyzedField: true,
        path: { wildcard: "*" },
      },
    },
  };
}
