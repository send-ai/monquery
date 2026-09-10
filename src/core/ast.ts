/** A literal as written in the filter string. `quoted` distinguishes `'null'` from `null`. */
export interface Literal {
  raw: string;
  quoted: boolean;
}

export interface Comparison {
  type: "cmp";
  key: string;
  op: string;
  values: Literal[];
  position: number;
}

export type FilterNode =
  | { type: "and"; nodes: FilterNode[] }
  | { type: "or"; nodes: FilterNode[] }
  | { type: "not"; node: FilterNode }
  | Comparison;

export const KEYWORDS = new Set(["and", "or", "not"]);
