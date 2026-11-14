import { EventEmitter } from "node:events";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLI_CRASH_EXIT, crashLine, guardCliHost } from "./cli-host";

/** A guarded fake process: an EventEmitter, a stubbed dialog, captured stderr and exit. */
function guarded() {
  const proc = new EventEmitter();
  const nativeBox = vi.fn();
  const dialog = { showErrorBox: nativeBox };
  let stderr = "";
  const exit = vi.fn();
  guardCliHost({ dialog, process: proc, stderr: (t) => void (stderr += t), exit });
  return { proc, dialog, nativeBox, exit, stderr: () => stderr };
}

describe("guardCliHost", () => {
  it("prints an uncaught exception to stderr and exits non-zero, with no dialog", () => {
    const g = guarded();
    g.proc.emit("uncaughtException", new Error("boom in the cli host\n    at secret stack"));
    expect(g.nativeBox).not.toHaveBeenCalled();
    expect(g.exit).toHaveBeenCalledWith(CLI_CRASH_EXIT);
    expect(CLI_CRASH_EXIT).not.toBe(0);
    expect(g.stderr()).toBe("mesh-ui: internal error: boom in the cli host\n");
  });

  it("handles an unhandled rejection the same way", () => {
    const g = guarded();
    g.proc.emit("unhandledRejection", "plain reason");
    expect(g.nativeBox).not.toHaveBeenCalled();
    expect(g.exit).toHaveBeenCalledWith(CLI_CRASH_EXIT);
    expect(g.stderr()).toContain("plain reason");
  });

  it("exits once when errors pile up", () => {
    const g = guarded();
    g.proc.emit("uncaughtException", new Error("first"));
    g.proc.emit("unhandledRejection", new Error("second"));
    expect(g.exit).toHaveBeenCalledTimes(1);
    expect(g.stderr()).not.toContain("second");
  });

  it("turns showErrorBox into a stderr line instead of a native box", () => {
    const g = guarded();
    g.dialog.showErrorBox("A JavaScript error occurred", "Error: bad\nstack line");
    expect(g.nativeBox).not.toHaveBeenCalled();
    expect(g.stderr()).toBe("mesh-ui: A JavaScript error occurred: Error: bad\n");
    expect(g.exit).not.toHaveBeenCalled();
  });

  it("prints only the first message line, capped, never the error's other fields", () => {
    const err = Object.assign(new Error("short"), { token: "s=secret-token" });
    expect(crashLine(err)).toBe("short");
    expect(crashLine({ token: "x" })).toBe("unexpected error");
    expect(crashLine(new Error(""))).toBe("unexpected error");
    expect(crashLine("x".repeat(500))).toHaveLength(303);
  });
});

type Plan = { argv: string[]; env: Record<string, string | undefined>; userDataDir: string | null };
type LaunchPlan = (o: { main: string; args: string[]; env: Record<string, string>; platform: string; tmp: string }) => Plan;

async function launchPlan(): Promise<LaunchPlan> {
  const path = "../../scripts/mesh-ui-dev.mjs";
  return ((await import(/* @vite-ignore */ path)) as { launchPlan: LaunchPlan }).launchPlan;
}

describe("dev launcher (scripts/mesh-ui-dev.mjs)", () => {
  const env = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", ELECTRON_RUN_AS_NODE: "1", DBUS_SESSION_BUS_ADDRESS: "unix:path=/bus" };

  it("on Linux strips the display and runs ozone headless, keeping the session bus for the keychain", async () => {
    const plan = (await launchPlan())({ main: "out/main/index.js", args: ["--demo", "run", "network.list"], env, platform: "linux", tmp: "/tmp" });
    expect(plan.env.DISPLAY).toBeUndefined();
    expect(plan.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(plan.env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/bus");
    expect(plan.argv.slice(0, 2)).toEqual(["out/main/index.js", "--cli"]);
    expect(plan.argv).toContain("--ozone-platform=headless");
    expect(plan.argv).toContain("--disable-gpu");
    expect(plan.argv.slice(-3)).toEqual(["--demo", "run", "network.list"]);
  });

  it("uses a scratch user data dir unless one is given", async () => {
    const plan = (await launchPlan())({ main: "m", args: [], env: {}, platform: "linux", tmp: "/scratch" });
    expect(plan.argv).toContain(`--user-data-dir=${join("/scratch", "mesh-ui-dev-cli")}`);
    const given = (await launchPlan())({ main: "m", args: ["--user-data-dir=/x"], env: {}, platform: "linux", tmp: "/scratch" });
    expect(given.userDataDir).toBeNull();
  });

  it("adds no Linux switches on other platforms", async () => {
    const plan = (await launchPlan())({ main: "m", args: [], env: {}, platform: "darwin", tmp: "/t" });
    expect(plan.argv).not.toContain("--ozone-platform=headless");
  });
});
