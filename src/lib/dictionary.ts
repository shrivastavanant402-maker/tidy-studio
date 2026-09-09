import type { ColumnType } from "./clean";

export type DictType = "auto" | ColumnType;

export type DictColumn = {
  /** header as it appears in the uploaded file (matched loosely) */
  column: string;
  /** optional tidy name to use instead */
  rename?: string;
  type: DictType;
  /** acceptable values; anything else is snapped to the closest one or cleared */
  allowed?: string[];
};

export const DICT_STORAGE_KEY = "tidy.dictionary.v1";

export const emptyEntry = (): DictColumn => ({ column: "", rename: "", type: "auto", allowed: [] });

export function loadDictionary(): DictColumn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DICT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is DictColumn => !!e && typeof (e as DictColumn).column === "string");
  } catch {
    return [];
  }
}

export function saveDictionary(entries: DictColumn[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DICT_STORAGE_KEY,
    JSON.stringify(entries.filter((e) => e.column.trim())),
  );
  window.dispatchEvent(
    new CustomEvent("tidy:dictionary-updated", {
      detail: entries.filter((e) => e.column.trim()),
    }),
  );
}
