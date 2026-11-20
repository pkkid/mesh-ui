/**
 * The Devices table sort (column and direction), remembered across launches
 * in localStorage. Pure view state, not a command; shared by every network.
 */
import { type DeviceSortKey, SORT_KEYS } from "../../../../core/commands/device";

export type SortOrder = "asc" | "desc";
export type SavedSort = { sort: DeviceSortKey; order: SortOrder };

export const SORT_STORAGE_KEY = "mesh-ui:devices:sort:v1";
export const DEFAULT_SORT: SavedSort = { sort: "name", order: "asc" };

/** Parses the saved sort; anything missing or unknown reads as the default (Device, A to Z). */
export function parseSort(raw: string | null): SavedSort {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Record<keyof SavedSort, unknown>> | null) : null;
    if (v && (SORT_KEYS as readonly unknown[]).includes(v.sort) && (v.order === "asc" || v.order === "desc")) {
      return { sort: v.sort as DeviceSortKey, order: v.order };
    }
  } catch {
    // Fall through to the default.
  }
  return { ...DEFAULT_SORT };
}

export function readSort(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): SavedSort {
  try {
    return parseSort(storage?.getItem(SORT_STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SORT };
  }
}

export function saveSort({ sort, order }: SavedSort, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(SORT_STORAGE_KEY, JSON.stringify({ sort, order }));
  } catch {
    // Storage unavailable: the sort resets next launch.
  }
}
