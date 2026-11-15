import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDemoSwitch, type DemoSwitchDeps, relaunchArgs } from "./demo-switch";

/** A stubbed Electron `app` that records relaunch and exit. */
function stub(argv: string[], env: Record<string, string | undefined> = {}) {
  const calls: { relaunch: { args: string[]; execPath?: string }[]; exit: (number | undefined)[] } = { relaunch: [], exit: [] };
  const deferred: (() => void)[] = [];
  const deps: DemoSwitchDeps = {
    app: { relaunch: (o) => calls.relaunch.push(o), exit: (c) => calls.exit.push(c) },
    argv,
    env,
    defer: (fn) => deferred.push(fn),
  };
  return { deps, calls, env, flush: () => deferred.splice(0).forEach((fn) => fn()), sw: createDemoSwitch(deps) };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A user data dir with a settings file, to prove the switch leaves both alone. */
function userData() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mesh-ui-M6.8-demo-"));
  dirs.push(dir);
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ theme: "grove", lastNetworkId: "n1" }));
  return { dir, settings, before: { text: readFileSync(settings, "utf8"), mtime: statSync(settings).mtimeMs } };
}

describe("demo switch", () => {
  it("entering adds --demo once and keeps the user data dir", async () => {
    const u = userData();
    const s = stub(["/opt/Mesh UI/mesh-ui", `--user-data-dir=${u.dir}`, "--demo", "--enable-logging"], { MESH_UI_USER_DATA_DIR: u.dir });
    await s.sw.demo(true);
    expect(s.calls.relaunch).toEqual([{ args: [`--user-data-dir=${u.dir}`, "--enable-logging", "--demo"] }]);
    expect(s.calls.relaunch[0]?.args.filter((a) => a === "--demo")).toHaveLength(1);
    expect(s.env.MESH_UI_USER_DATA_DIR).toBe(u.dir);
    // Exit waits so the command's answer reaches the window first.
    expect(s.calls.exit).toEqual([]);
    s.flush();
    expect(s.calls.exit).toEqual([0]);
    expect(readFileSync(u.settings, "utf8")).toBe(u.before.text);
    expect(statSync(u.settings).mtimeMs).toBe(u.before.mtime);
  });

  it("leaving removes every --demo and MESH_UI_DEMO, keeping the rest", async () => {
    const u = userData();
    const s = stub(["/usr/bin/electron", "/app", "--demo", "--user-data-dir", u.dir, "--demo"], { MESH_UI_DEMO: "1", MESH_UI_USER_DATA_DIR: u.dir, HOME: "/home/alex" });
    await s.sw.demo(false);
    expect(s.calls.relaunch).toEqual([{ args: ["/app", "--user-data-dir", u.dir] }]);
    expect(s.env).toEqual({ MESH_UI_USER_DATA_DIR: u.dir, HOME: "/home/alex" });
    s.flush();
    expect(s.calls.exit).toEqual([0]);
    expect(readFileSync(u.settings, "utf8")).toBe(u.before.text);
    expect(statSync(u.settings).mtimeMs).toBe(u.before.mtime);
  });

  it("relaunches the AppImage file, not the binary in its mount", async () => {
    const s = stub(["/tmp/.mount_MeshUI/mesh-ui"], { APPIMAGE: "/home/alex/Mesh-UI.AppImage" });
    await s.sw.demo(true);
    expect(s.calls.relaunch).toEqual([{ args: ["--demo"], execPath: "/home/alex/Mesh-UI.AppImage" }]);
  });

  it("relaunchArgs never duplicates the flag", () => {
    expect(relaunchArgs(["exe"], true)).toEqual(["--demo"]);
    expect(relaunchArgs(["exe", "--demo"], true)).toEqual(["--demo"]);
    expect(relaunchArgs(["exe", "--demo"], false)).toEqual([]);
    expect(relaunchArgs(["exe", "--demo=x", "--fake"], false)).toEqual(["--demo=x", "--fake"]);
  });
});
