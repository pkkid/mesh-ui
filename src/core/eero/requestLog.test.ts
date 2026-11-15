import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RequestLogEntry } from "./client";
import { fileRequestLog, REQUEST_LOG_OLD_FILE, requestLogPath } from "./requestLog";

const entry = (over: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
  method: "POST",
  path: "/2.2/login/verify",
  status: 401,
  eeroError: "error.session.invalid",
  ms: 120,
  outcome: "error",
  code: "eero_error",
  message: "eero did not accept this sign-in. Start again.",
  ...over,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mesh-ui-reqlog-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fileRequestLog", () => {
  it("appends one JSON line per request with time and surface", async () => {
    const path = requestLogPath(dir);
    const log = fileRequestLog(path, "ui", { now: () => Date.UTC(2026, 10, 15, 12) });
    log(entry());
    log(entry({ method: "GET", path: "/2.2/account", status: 200, eeroError: null, outcome: "ok", code: undefined, message: undefined }));
    await log.flush();
    const lines = (await readFile(path, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ time: "2026-11-15T12:00:00.000Z", surface: "ui", path: "/2.2/login/verify", status: 401, eeroError: "error.session.invalid" });
    expect(lines[1]).toMatchObject({ method: "GET", outcome: "ok" });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("moves a full file aside and starts a new one", async () => {
    const path = requestLogPath(dir);
    const log = fileRequestLog(path, "cli", { maxBytes: 600 });
    for (let i = 0; i < 6; i++) log(entry({ ms: i }));
    await log.flush();
    const current = (await readFile(path, "utf8")).trim().split("\n");
    const old = (await readFile(join(dir, REQUEST_LOG_OLD_FILE), "utf8")).trim().split("\n");
    expect(current.length + old.length).toBeLessThanOrEqual(6);
    expect(JSON.parse(current.at(-1) ?? "{}").ms).toBe(5);
    expect((await stat(path)).size).toBeLessThanOrEqual(600);
  });

  it("never throws when the folder cannot be written", async () => {
    const log = fileRequestLog(join(dir, "missing\0bad", "x.jsonl"), "ui");
    expect(() => log(entry())).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
  });
});
