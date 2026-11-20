import { describe, expect, it } from "vitest";

import { parseSort, readSort, saveSort, SORT_STORAGE_KEY } from "./deviceSort";

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("device table sort", () => {
  it("defaults to Device, A to Z", () => {
    expect(parseSort(null)).toEqual({ sort: "name", order: "asc" });
  });

  it("ignores unknown or malformed values", () => {
    expect(parseSort("nope")).toEqual({ sort: "name", order: "asc" });
    expect(parseSort("null")).toEqual({ sort: "name", order: "asc" });
    expect(parseSort('{"sort":"colour","order":"asc"}')).toEqual({ sort: "name", order: "asc" });
    expect(parseSort('{"sort":"usage","order":"up"}')).toEqual({ sort: "name", order: "asc" });
  });

  it("round-trips a saved column and direction", () => {
    const storage = memoryStorage();
    saveSort({ sort: "signal", order: "asc" }, storage);
    expect(JSON.parse(storage.data.get(SORT_STORAGE_KEY) ?? "")).toEqual({ sort: "signal", order: "asc" });
    expect(readSort(storage)).toEqual({ sort: "signal", order: "asc" });
  });

  it("falls back to the default when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readSort(broken)).toEqual({ sort: "name", order: "asc" });
    expect(() => saveSort({ sort: "usage", order: "desc" }, broken)).not.toThrow();
  });
});
