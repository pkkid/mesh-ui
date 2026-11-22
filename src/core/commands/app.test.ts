import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { createEngine } from "../engine";
import type { AppInfo, AppSettings, AuditList, CliStatus, HostEvent, UpdateStatus } from "../model";
import type { HostActions } from "../spec";

const host = { version: "9.9.9", electron: "45.0.0", configDir: "/tmp/mesh-ui-test", keychainName: "Test Keychain" };

describe("app.info", () => {
  it("reports the host, the backend and the session storage", async () => {
    const engine = createEngine({ backend: createDemoBackend(), host });
    const res = await engine.execute<AppInfo>("app.info");
    expect(res).toEqual({
      ok: true,
      result: {
        version: "9.9.9",
        electron: "45.0.0",
        os: process.platform,
        arch: process.arch,
        backend: "demo",
        fakeServer: false,
        sessionStorage: "memory",
        keychainName: null,
        install: "dev",
        update: { state: "unsupported", version: null, channel: "latest", checkedAt: null, progress: null, error: null },
        cli: null,
        tray: null,
        configDir: "/tmp/mesh-ui-test",
      },
    });
  });

  it("works signed out and rejects params", async () => {
    const engine = createEngine({ backend: createDemoBackend({ scenario: "signed_out" }) });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "demo", configDir: "" } });
    expect(await engine.execute("app.info", { verbose: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("app.info", { networkId: "x" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("names the keychain when the eero session is kept there", async () => {
    const server = createFakeEero();
    const secrets: SecretStore = { load: async () => null, save: async () => "keychain", clear: async () => {}, storage: async () => "keychain" };
    const engine = createEngine({ backend: createEeroBackend({ secrets, origin: server.origin, fetch: server.fetch }), host });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "eero", fakeServer: true, sessionStorage: "keychain", keychainName: "Test Keychain" } });
    expect(server.log).toHaveLength(0);
  });

  it("reports fakeServer false for the live eero backend", async () => {
    const secrets: SecretStore = { load: async () => null, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const engine = createEngine({ backend: createEeroBackend({ secrets }), host });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "eero", fakeServer: false } });
  });
});

describe("demo.scenario.set", () => {
  it("switches scenarios and emits session.changed when the session flips", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    const events: HostEvent[] = [];
    engine.onEvent((e) => events.push(e));
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { networkCount: 3 } });

    expect(await engine.execute("demo.scenario.set", { scenario: "no_networks" })).toMatchObject({ ok: true, result: { scenario: "no_networks", signedIn: true } });
    // The cached account is dropped, so the new fixtures show.
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { networkCount: 0 } });
    expect(events).toEqual([]);

    expect(await engine.execute("demo.scenario.set", { scenario: "signed_out" })).toMatchObject({ ok: true, result: { signedIn: false } });
    expect(events).toEqual([{ type: "session.changed", state: "signed_out", storage: "memory" }]);
    expect(await engine.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });

    // App scope: it runs while signed out, so tests can get back.
    expect(await engine.execute("demo.scenario.set", { scenario: "default" })).toMatchObject({ ok: true, result: { signedIn: true } });
    expect(events.at(-1)).toEqual({ type: "session.changed", state: "signed_in", storage: "memory" });
  });

  it("rejects unknown scenarios and missing params", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    for (const params of [{}, { scenario: "nope" }, { scenario: 1 }, { scenario: "default", extra: 1 }]) {
      expect(await engine.execute("demo.scenario.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("is registered only with the demo backend", () => {
    const secrets: SecretStore = { load: async () => null, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const live = createEngine({ backend: createEeroBackend({ secrets, origin: "http://127.0.0.1:1" }) });
    expect(live.commands().some((c) => c.id === "demo.scenario.set")).toBe(false);
    expect(createEngine({ backend: createDemoBackend() }).commands().some((c) => c.id === "demo.scenario.set")).toBe(true);
  });
});

const READY: UpdateStatus = { state: "ready", version: "9.9.10", channel: "latest", checkedAt: "2026-11-14T12:00:00.000Z", progress: null, error: null };
const CLI: CliStatus = { installed: true, path: "/usr/local/bin/mesh-ui", onPath: true, canInstall: true, reinstall: false, pathLine: null };

/** Host actions that record what was asked of them. */
function fakeActions(update: UpdateStatus = READY) {
  const calls: string[] = [];
  const actions: HostActions = {
    update: { status: async () => update, check: async () => (calls.push("check"), update), install: async () => void calls.push("install") },
    cli: { status: async () => CLI, install: async () => (calls.push("cli"), CLI) },
    relaunch: { demo: async (enabled) => void calls.push(`demo:${enabled}`) },
    logs: { showRequestLog: async () => (calls.push("log"), { path: "/cfg/eero-requests.jsonl", exists: true }) },
  };
  return { actions, calls };
}

const HOST_ONLY_IDS: [string, unknown][] = [
  ["app.cli.install", {}],
  ["app.update.check", {}],
  ["app.update.install", {}],
  ["app.demo.set", { enabled: true }],
  ["app.log.show", {}],
];

describe("app.info with host actions", () => {
  it("reports the install kind, the updater and the CLI from the window's host", async () => {
    const { actions } = fakeActions();
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, install: "appimage", actions } });
    expect(await engine.execute<AppInfo>("app.info")).toMatchObject({ ok: true, result: { install: "appimage", update: READY, cli: CLI } });
  });

  it("follows the update channel setting when there is no updater", async () => {
    const engine = createEngine({ backend: createDemoBackend(), host });
    expect(await engine.execute("app.settings.set", { updateChannel: "beta" })).toMatchObject({ ok: true });
    expect(await engine.execute<AppInfo>("app.info")).toMatchObject({ ok: true, result: { update: { state: "unsupported", channel: "beta" } } });
  });

  it("polls every 60 s, as app.audit.list does", () => {
    const list = createEngine({ backend: createDemoBackend() }).commands();
    expect(list.find((c) => c.id === "app.info")?.poll).toBe(60);
    expect(list.find((c) => c.id === "app.audit.list")?.poll).toBe(60);
  });
});

describe("app.settings.get and .set", () => {
  it("reads the defaults, including automatic updates on the latest channel", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    expect(await engine.execute<AppSettings>("app.settings.get")).toMatchObject({ ok: true, result: { autoUpdate: true, updateChannel: "latest", userAgent: null, openOnLaunch: null } });
  });

  it("changes only the settings given and the next read shows them", async () => {
    const engine = createEngine({ backend: createDemoBackend({ scenario: "signed_out" }) });
    const res = await engine.execute<AppSettings>("app.settings.set", { autoUpdate: false, userAgent: "eero/7.0 (iPhone)" });
    expect(res).toMatchObject({ ok: true, result: { autoUpdate: false, userAgent: "eero/7.0 (iPhone)", updateChannel: "latest" } });
    expect(await engine.execute("app.settings.get")).toMatchObject({ ok: true, result: { autoUpdate: false } });
    expect(await engine.execute("app.settings.set", { userAgent: null, openOnLaunch: "100001" })).toMatchObject({ ok: true, result: { userAgent: null, openOnLaunch: "100001" } });
  });

  it("rejects an empty patch, unknown keys and wrong types", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    for (const params of [{}, { lastNetworkId: "x" }, { planMbps: {} }, { autoUpdate: "yes" }, { updateChannel: "nightly" }, { userAgent: "" }]) {
      expect(await engine.execute("app.settings.set", params), JSON.stringify(params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    expect(await engine.execute("app.settings.get", { x: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("keep running in the tray (runInTray)", () => {
  it("round-trips through app.settings.set and get, off by default", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    expect(await engine.execute<AppSettings>("app.settings.get")).toMatchObject({ ok: true, result: { runInTray: false } });
    expect(await engine.execute<AppSettings>("app.settings.set", { runInTray: true })).toMatchObject({ ok: true, result: { runInTray: true } });
    expect(await engine.execute<AppSettings>("app.settings.get")).toMatchObject({ ok: true, result: { runInTray: true } });
    expect(await engine.execute("app.settings.set", { runInTray: "yes" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("tells the window's tray at once, and only when the setting is in the patch", async () => {
    const applied: boolean[] = [];
    let available = true;
    const tray = { available: async () => available, apply: async (on: boolean) => (applied.push(on), on && available) };
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, actions: { tray } } });
    expect(await engine.execute<AppInfo>("app.info")).toMatchObject({ ok: true, result: { tray: true } });
    await engine.execute("app.settings.set", { runInTray: true });
    await engine.execute("app.settings.set", { autoUpdate: false });
    await engine.execute("app.settings.set", { runInTray: false });
    expect(applied).toEqual([true, false]);
    available = false;
    expect(await engine.execute<AppInfo>("app.info")).toMatchObject({ ok: true, result: { tray: false } });
  });

  it("reports no tray where the host has none (CLI, MCP)", async () => {
    const engine = createEngine({ backend: createDemoBackend(), host });
    expect(await engine.execute<AppInfo>("app.info")).toMatchObject({ ok: true, result: { tray: null } });
  });
});

describe("app.audit.list", () => {
  it("answers an empty week until the log is read (M6.6)", async () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const engine = createEngine({ backend: createDemoBackend(), host, clock: () => now });
    const res = await engine.execute<AuditList>("app.audit.list", { limit: 5 });
    expect(res).toMatchObject({ ok: true, result: { entries: [], weekTotal: 0, needsConfirm: 0, mcpLastAt: null } });
    if (res.ok) expect(res.result.week).toHaveLength(7);
  });

  it("rejects a limit out of range", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    for (const limit of [0, 201, 1.5, "5"]) expect(await engine.execute("app.audit.list", { limit })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("host-only app commands", () => {
  it.each(HOST_ONLY_IDS)("%s answers bad_params without host actions (CLI and MCP)", async (id, params) => {
    for (const surface of ["cli", "mcp"] as const) {
      const engine = createEngine({ backend: createDemoBackend(), surface, host });
      expect(await engine.execute(id, params)).toEqual({ ok: false, error: { code: "bad_params", message: "Only in the Mesh UI window." } });
    }
  });

  it("app.cli.install and app.update.check call the window's host", async () => {
    const { actions, calls } = fakeActions();
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, actions } });
    expect(await engine.execute("app.cli.install")).toEqual({ ok: true, result: CLI });
    expect(await engine.execute("app.update.check")).toEqual({ ok: true, result: READY });
    expect(calls).toEqual(["cli", "check"]);
    expect(await engine.execute("app.cli.install", { force: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("app.log.show asks the window to show the eero request log", async () => {
    const { actions, calls } = fakeActions();
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, actions } });
    expect(await engine.execute("app.log.show")).toEqual({ ok: true, result: { path: "/cfg/eero-requests.jsonl", exists: true } });
    expect(calls).toEqual(["log"]);
    expect(await engine.execute("app.log.show", { extra: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("app.update.install restarts only when an update is ready", async () => {
    const ready = fakeActions();
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, actions: ready.actions } });
    expect(await engine.execute("app.update.install")).toEqual({ ok: true, result: { restarting: true, version: "9.9.10" } });
    expect(ready.calls).toEqual(["install"]);

    const idle = fakeActions({ ...READY, state: "idle", version: null });
    const engine2 = createEngine({ backend: createDemoBackend(), host: { ...host, actions: idle.actions } });
    expect(await engine2.execute("app.update.install")).toMatchObject({ ok: false, error: { code: "bad_params", message: "No update is ready to install." } });
    expect(idle.calls).toEqual([]);
  });

  it("app.demo.set relaunches only when the mode changes", async () => {
    const { actions, calls } = fakeActions();
    const engine = createEngine({ backend: createDemoBackend(), host: { ...host, actions } });
    expect(await engine.execute("app.demo.set", { enabled: true })).toEqual({ ok: true, result: { demo: true, restarting: false } });
    expect(await engine.execute("app.demo.set", { enabled: false })).toEqual({ ok: true, result: { demo: false, restarting: true } });
    expect(calls).toEqual(["demo:false"]);
    for (const params of [{}, { enabled: "yes" }]) expect(await engine.execute("app.demo.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});
