/**
 * cliMain ends the run through the exit it is given, never process.exit
 * directly: the Electron host passes its own, which on Windows waits for
 * Chromium's startup to settle so the exit does not crash (src/main/cli-host.ts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../../package.json";
import { cliMain, EXIT, nodeHost } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cliMain exit", () => {
  it("passes the run's exit code to the given exit after output is written", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string, cb?: () => void) => {
      if (chunk) out.push(String(chunk));
      cb?.();
      return true;
    }) as typeof process.stdout.write);
    const processExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const exit = vi.fn();
    await cliMain(["--version"], nodeHost(), exit);
    expect(exit).toHaveBeenCalledWith(EXIT.ok);
    expect(out.join("")).toBe(`${version}\n`);
    expect(processExit).not.toHaveBeenCalled();
  });

  it("passes a failing code through unchanged", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(((_c: string, cb?: () => void) => (cb?.(), true)) as typeof process.stdout.write);
    vi.spyOn(process.stderr, "write").mockImplementation(((_c: string, cb?: () => void) => (cb?.(), true)) as typeof process.stderr.write);
    const processExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const exit = vi.fn();
    await cliMain(["--demo", "run", "no.such.command"], nodeHost(), exit);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit.mock.calls[0]?.[0]).not.toBe(EXIT.ok);
    expect(processExit).not.toHaveBeenCalled();
  });
});
