/** The dev tools panel's record list, filter and labels (devtools.ts). */
import { describe, expect, it } from "vitest";

import type { InspectRecord } from "../../../../core/eero/inspect";
import { formatMs, MAX_RECORDS, matches, requestPath, tagFor, upsertRecord } from "./devtools";
import { parseJsonBlock } from "./JsonTree";

const rec = (over: Partial<InspectRecord> = {}): InspectRecord => ({
  id: 1,
  startedAt: 0,
  method: "GET",
  url: "https://api-user.e2ro.com/2.2/networks/1/devices?thread=true",
  command: "device.list",
  attempt: 0,
  requestHeaders: [],
  requestBody: null,
  status: 200,
  responseHeaders: [],
  responseBody: "{}",
  responseBytes: 2,
  truncated: false,
  timing: { queuedMs: 0, waitMs: 10, downloadMs: 2, totalMs: 12 },
  outcome: "ok",
  eeroError: null,
  error: null,
  ...over,
});

describe("dev tools records", () => {
  it("updates a record in place by id and keeps the newest MAX_RECORDS", () => {
    const one = upsertRecord([], rec({ outcome: "pending", status: null }));
    expect(upsertRecord(one, rec())).toEqual([rec()]);
    let list: InspectRecord[] = [];
    for (let i = 0; i < MAX_RECORDS + 5; i++) list = upsertRecord(list, rec({ id: i }));
    expect(list).toHaveLength(MAX_RECORDS);
    expect(list[0]?.id).toBe(5);
  });

  it("filters on method, path, command and status, and errors only", () => {
    expect(matches(rec(), "devices", false)).toBe(true);
    expect(matches(rec(), "DEVICE.LIST", false)).toBe(true);
    expect(matches(rec(), "eeros", false)).toBe(false);
    expect(matches(rec(), "", true)).toBe(false);
    expect(matches(rec({ status: 429, outcome: "retry" }), "", true)).toBe(true);
    expect(matches(rec({ status: null, outcome: "error" }), "", true)).toBe(true);
  });

  it("labels what the client did with an attempt", () => {
    expect(tagFor(rec())).toBeNull();
    expect(tagFor(rec({ outcome: "refresh", status: 401 }))).toBe("refreshed");
    expect(tagFor(rec({ outcome: "retry", status: 429 }))).toBe("rate limited");
    expect(tagFor(rec({ attempt: 1 }))).toBe("replay");
    expect(tagFor(rec({ status: null, outcome: "error" }))).toBe("no response");
    expect(tagFor(rec({ outcome: "pending" }))).toBe("pending");
  });

  it("formats paths and times, and shows only JSON objects and arrays as a tree", () => {
    expect(requestPath(rec())).toBe("/2.2/networks/1/devices?thread=true");
    expect(formatMs(412.4)).toBe("412 ms");
    expect(formatMs(1234)).toBe("1.2 s");
    expect(formatMs(undefined)).toBe("-");
    expect(parseJsonBlock(' {"a":[1,true,null]}')).toEqual({ a: [1, true, null] });
    expect(parseJsonBlock('"just a string"')).toBeUndefined();
    expect(parseJsonBlock('{"cut": "at 256 KB')).toBeUndefined();
    expect(parseJsonBlock(null)).toBeUndefined();
  });
});
