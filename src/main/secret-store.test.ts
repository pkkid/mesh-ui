/**
 * Host tests (docs/testing.md#host-tests): the safeStorage SecretStore with a
 * fake safeStorage whose backend can be switched, and the window.mesh bridge
 * (src/main/ipc.ts) driven end to end through a fake IPC pair that records
 * every payload crossing it, to prove the token never does.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type AuthState, composeBackend, type SecretStore } from "../core/backend";
import { createEngine } from "../core/engine";
import { BackendError } from "../core/errors";
import type { HostEvent } from "../core/model";
import { defineCommand } from "../core/spec";
import { IPC } from "../shared/types";
import { createMeshBridge, type IpcMainLike, type IpcRendererLike, registerIpc } from "./ipc";
import { configPaths, resolveConfigDir } from "./paths";
import { createSecretStore, keychainName, type SafeStorageLike, storageKind } from "./secret-store";

const TOKEN = "s-token-0123456789abcdef-SECRET";

type FakeBackend = "keychain" | "gnome_libsecret" | "kwallet6" | "basic_text" | "unknown" | "unavailable";

/** A stand-in for Electron safeStorage. "Encryption" is reversible but never plaintext. */
function fakeSafeStorage(initial: FakeBackend) {
  let backend = initial;
  const fake: SafeStorageLike & { use(b: FakeBackend): void } = {
    use: (b) => {
      backend = b;
    },
    isEncryptionAvailable: () => backend !== "unavailable",
    getSelectedStorageBackend: () => (backend === "keychain" || backend === "unavailable" ? "unknown" : backend),
    encryptString: (plain) => Buffer.concat([Buffer.from("ENC1"), Buffer.from(plain, "utf8").map((b) => b ^ 0x5a)]),
    decryptString: (buf) => {
      if (buf.subarray(0, 4).toString() !== "ENC1") throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      return Buffer.from(buf.subarray(4).map((b) => b ^ 0x5a)).toString("utf8");
    },
  };
  return fake;
}

/** "keychain" means a platform with a real OS store and no Linux backend check. */
const platformFor = (b: FakeBackend): NodeJS.Platform => (b === "keychain" ? "darwin" : "linux");

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-ui-host-test-"));
  file = path.join(dir, "config", "session.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store(b: FakeBackend) {
  const safe = fakeSafeStorage(b);
  return { safe, secrets: createSecretStore({ file, safeStorage: safe, platform: platformFor(b) }) };
}

const writeRaw = (body: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
};

const encryptedB64 = (token: string) => fakeSafeStorage("keychain").encryptString(token).toString("base64");

describe("SecretStore with a keychain", () => {
  it.each(["keychain", "gnome_libsecret", "kwallet6"] as const)("%s: saves encrypted, owner-only, and loads it back", async (b) => {
    const { secrets } = store(b);
    expect(await secrets.storage()).toBe("keychain");
    expect(await secrets.save(TOKEN)).toBe("keychain");

    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain(TOKEN);
    expect(JSON.parse(raw)).toEqual({ v: 2, token: encryptedB64(TOKEN) });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["session.json"]);

    expect(await secrets.load()).toBe(TOKEN);
  });

  it("writes atomically, fixing a leftover temp file's loose mode", async () => {
    const { secrets } = store("keychain");
    const tmp = `${file}.${process.pid}.tmp`;
    writeRaw("half-written");
    fs.writeFileSync(tmp, "stale", { mode: 0o644 });
    await secrets.save(TOKEN);
    expect(fs.existsSync(tmp)).toBe(false);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(await secrets.load()).toBe(TOKEN);
  });

  it("reads an encrypted v1 file and rewrites it as v2", async () => {
    const { secrets } = store("keychain");
    writeRaw({ v: 1, encrypted: true, token: encryptedB64(TOKEN) });
    expect(await secrets.load()).toBe(TOKEN);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ v: 2, token: encryptedB64(TOKEN) });
  });

  it("returns null with no file", async () => {
    expect(await store("keychain").secrets.load()).toBeNull();
  });

  it("names the keychain per OS", () => {
    expect(keychainName(fakeSafeStorage("keychain"), "darwin")).toBe("macOS Keychain");
    expect(keychainName(fakeSafeStorage("keychain"), "win32")).toBe("Windows DPAPI");
    expect(keychainName(fakeSafeStorage("gnome_libsecret"), "linux")).toBe("GNOME Keyring");
    expect(keychainName(fakeSafeStorage("kwallet6"), "linux")).toBe("KWallet");
    expect(keychainName(fakeSafeStorage("basic_text"), "linux")).toBeNull();
  });
});

describe.each(["basic_text", "unknown", "unavailable"] as const)("SecretStore without a real keychain (%s)", (b) => {
  it("reports memory and writes nothing", async () => {
    const { secrets, safe } = store(b);
    expect(storageKind(safe, "linux")).toBe("memory");
    expect(await secrets.storage()).toBe("memory");
    expect(await secrets.save(TOKEN)).toBe("memory");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("deletes an existing session file on save and on load", async () => {
    const { secrets } = store(b);
    writeRaw({ v: 2, token: encryptedB64(TOKEN) });
    expect(await secrets.load()).toBeNull();
    expect(fs.existsSync(file)).toBe(false);

    writeRaw({ v: 2, token: encryptedB64(TOKEN) });
    await secrets.save(TOKEN);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("SecretStore drops files it cannot trust", () => {
  it.each([
    ["v1 plaintext", { v: 1, encrypted: false, token: TOKEN }],
    ["v1 with no flag", { v: 1, token: TOKEN }],
    ["unversioned plaintext", { token: TOKEN }],
    ["not JSON", `s=${TOKEN}`],
    ["no token", { v: 2 }],
    ["undecryptable", { v: 2, token: Buffer.from("garbage").toString("base64") }],
  ])("%s: deleted on load", async (_name, body) => {
    const { secrets } = store("keychain");
    writeRaw(body);
    expect(await secrets.load()).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("a file saved while a keychain existed is deleted once it is gone", async () => {
    const { secrets, safe } = store("gnome_libsecret");
    await secrets.save(TOKEN);
    safe.use("basic_text");
    expect(await secrets.load()).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("sign-out", () => {
  it("clear deletes the file and is safe to repeat", async () => {
    const { secrets } = store("keychain");
    await secrets.save(TOKEN);
    await secrets.clear();
    expect(fs.existsSync(file)).toBe(false);
    await expect(secrets.clear()).resolves.toBeUndefined();
    expect(await secrets.load()).toBeNull();
  });

  it("the file is gone even when the eero logout call fails", async () => {
    const { secrets } = store("keychain");
    await secrets.save(TOKEN);
    // The shape auth.logout follows (security.md): clear locally first, then tell eero.
    const backend = composeBackend("eero", {
      auth: {
        status: async () => ({ signedIn: true, pending: false, login: null, storage: "keychain" }),
        start: async () => {},
        verify: async () => {},
        resend: async () => {},
        logout: async () => {
          await secrets.clear();
          throw new BackendError("network_error", "Could not reach eero.");
        },
      },
    });
    const engine = createEngine({
      backend,
      commands: [
        defineCommand({ id: "auth.logout", label: "Sign out", params: z.object({}), effect: "write", scope: "app", run: (ctx) => ctx.backend.auth.logout() }),
      ],
    });
    const res = await engine.execute("auth.logout");
    expect(res.ok).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("paths", () => {
  it("uses a lowercase mesh-ui dir under appData unless overridden", () => {
    const appData = path.join(dir, "AppData");
    expect(resolveConfigDir({ appData, userDataSwitch: "", env: {} })).toBe(path.join(appData, "mesh-ui"));
    expect(resolveConfigDir({ appData, userDataSwitch: path.join(dir, "x"), env: {} })).toBe(path.join(dir, "x"));
    expect(resolveConfigDir({ appData, userDataSwitch: "", env: { MESH_UI_USER_DATA_DIR: path.join(dir, "y") } })).toBe(path.join(dir, "y"));
    const p = configPaths(path.join(dir, "c"));
    expect(p.session).toBe(path.join(dir, "c", "session.json"));
    expect(p.settings).toBe(path.join(dir, "c", "settings.json"));
    expect(p.cliSessionData).toBe(path.join(dir, "c", "cli"));
  });
});

// ---------------------------------------------------------------------------
// The bridge

const APP_URL = "file:///app/renderer/index.html";

/** Connects registerIpc to createMeshBridge, cloning and recording every payload like Electron does. */
function fakeIpc() {
  const payloads: unknown[] = [];
  const handlers = new Map<string, (e: { senderFrame: { url: string } }, ...a: unknown[]) => unknown>();
  const listeners = new Map<string, (e: { senderFrame: { url: string } }, ...a: unknown[]) => void>();
  const rendererListeners = new Map<string, Set<(e: unknown, ...a: unknown[]) => void>>();
  let senderUrl = APP_URL;
  const record = <T>(v: T): T => {
    const copy = structuredClone(v);
    payloads.push(copy);
    return copy;
  };

  const main: IpcMainLike = {
    handle: (c, fn) => void handlers.set(c, fn as never),
    on: (c, fn) => void listeners.set(c, fn as never),
    removeHandler: (c) => void handlers.delete(c),
    removeAllListeners: (c) => void listeners.delete(c),
  };
  const renderer: IpcRendererLike = {
    invoke: async (c, ...args) => {
      const fn = handlers.get(c);
      if (!fn) throw new Error(`No handler registered for '${c}'`);
      return record(await fn({ senderFrame: { url: senderUrl } }, ...record(args)));
    },
    send: (c, ...args) => listeners.get(c)?.({ senderFrame: { url: senderUrl } }, ...record(args)),
    on: (c, fn) => {
      const set = rendererListeners.get(c) ?? new Set();
      set.add(fn);
      rendererListeners.set(c, set);
    },
    removeListener: (c, fn) => rendererListeners.get(c)?.delete(fn),
  };
  const broadcast = (c: string, event: HostEvent) => {
    for (const fn of rendererListeners.get(c) ?? []) fn({}, record(event));
  };
  return { main, renderer, broadcast, payloads, handlers, setSender: (u: string) => (senderUrl = u) };
}

async function bridgeSetup() {
  const { secrets } = store("keychain");
  await secrets.save(TOKEN);
  const auth: AuthState = { signedIn: true, pending: false, login: "al***@example.com", storage: "keychain" };
  // A backend that holds the token the way the eero backend does.
  const holder = (s: SecretStore) => ({ token: () => s.load() });
  const vault = holder(secrets);
  const backend = composeBackend("eero", {
    auth: {
      status: async () => auth,
      start: async () => {},
      verify: async () => {},
      resend: async () => {},
      logout: async () => secrets.clear(),
    },
  });
  const engine = createEngine({
    backend,
    host: { configDir: dir, keychainName: "macOS Keychain" },
    commands: [
      defineCommand({ id: "app.info", label: "App info", params: z.object({}), effect: "query", scope: "app", run: async (ctx) => ({ host: ctx.host, auth: await ctx.backend.auth.status() }) }),
      defineCommand({
        id: "test.leak",
        label: "Leaky failure",
        params: z.object({}),
        effect: "query",
        scope: "app",
        run: async () => {
          throw new Error(`request failed with Cookie: s=${await vault.token()}`);
        },
      }),
      defineCommand({ id: "test.reboot", label: "Reboot", params: z.object({}), effect: "disruptive", scope: "app", run: async () => ({ done: true }) }),
      defineCommand({
        id: "test.select",
        label: "Select",
        params: z.object({}),
        effect: "write",
        scope: "app",
        run: async (ctx) => {
          ctx.emit({ type: "session.changed", state: "signed_out", storage: "keychain" });
          ctx.emit({ type: "network.selected", networkId: "n1" });
          return null;
        },
      }),
    ],
  });
  const ipc = fakeIpc();
  const titlebar: unknown[] = [];
  const unregister = registerIpc(ipc.main, {
    engine,
    isAppUrl: (u) => u.startsWith("file:///app/renderer/"),
    broadcast: ipc.broadcast,
    setTitlebarColors: (c) => titlebar.push(c),
  });
  const mesh = createMeshBridge(ipc.renderer, "linux");
  return { mesh, ipc, titlebar, unregister };
}

describe("window.mesh bridge", () => {
  it("exposes execute, commands, on and setTitlebarColors over the mesh: channels", async () => {
    const { mesh, ipc } = await bridgeSetup();
    expect(mesh.platform).toBe("linux");
    expect([...ipc.handlers.keys()].sort()).toEqual([IPC.commands, IPC.execute].sort());

    const info = await mesh.execute<{ host: { configDir: string } }>("app.info");
    expect(info.ok && info.result.host.configDir).toBe(dir);

    const list = await mesh.commands();
    expect(list.map((c) => c.id)).toEqual(["app.info", "test.leak", "test.reboot", "test.select"]);
  });

  it("returns engine envelopes: unknown_command, needs_confirm, then ok with confirm", async () => {
    const { mesh } = await bridgeSetup();
    expect(await mesh.execute("nope.nope")).toMatchObject({ ok: false, error: { code: "unknown_command" } });
    expect(await mesh.execute("test.reboot")).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    expect(await mesh.execute("test.reboot", { confirm: true })).toEqual({ ok: true, result: { done: true } });
    expect(await mesh.execute("app.info", { extra: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("forwards host events to on() listeners until unsubscribed", async () => {
    const { mesh } = await bridgeSetup();
    const seen: HostEvent[] = [];
    const off = mesh.on((e) => seen.push(e));
    await mesh.execute("test.select");
    expect(seen).toEqual([
      { type: "session.changed", state: "signed_out", storage: "keychain" },
      { type: "network.selected", networkId: "n1" },
    ]);
    off();
    await mesh.execute("test.select");
    expect(seen).toHaveLength(2);
  });

  it("never carries the token: results, errors, listings and events", async () => {
    const { mesh, ipc } = await bridgeSetup();
    mesh.on(() => {});
    await mesh.commands();
    await mesh.execute("app.info");
    const leak = await mesh.execute("test.leak");
    expect(leak).toMatchObject({ ok: false, error: { code: "eero_error" } });
    await mesh.execute("test.reboot", { confirm: true });
    await mesh.execute("test.select");
    mesh.setTitlebarColors({ color: "#000000", symbolColor: "#ffffff" });

    expect(ipc.payloads.length).toBeGreaterThan(8);
    const wire = JSON.stringify(ipc.payloads);
    expect(wire).not.toContain(TOKEN);
    expect(wire).not.toContain("s=");
  });

  it("refuses requests from pages that are not the app", async () => {
    const { mesh, ipc, titlebar } = await bridgeSetup();
    ipc.setSender("https://evil.example/");
    expect(await mesh.execute("app.info")).toMatchObject({ ok: false, error: { code: "network_error" } });
    expect(await mesh.commands()).toEqual([]);
    mesh.setTitlebarColors({ color: "#000000", symbolColor: "#ffffff" });
    expect(titlebar).toEqual([]);
  });

  it("passes only well-formed titlebar colours", async () => {
    const { mesh, titlebar } = await bridgeSetup();
    mesh.setTitlebarColors({ color: "#111111", symbolColor: "#eeeeee" });
    mesh.setTitlebarColors({ color: 5, symbolColor: "#eeeeee" } as never);
    expect(titlebar).toEqual([{ color: "#111111", symbolColor: "#eeeeee" }]);
  });

  it("turns a lost IPC connection into network_error instead of throwing", async () => {
    const { mesh, unregister } = await bridgeSetup();
    unregister();
    expect(await mesh.execute("app.info")).toMatchObject({ ok: false, error: { code: "network_error" } });
    expect(await mesh.commands()).toEqual([]);
  });

  it("keeps the prototype calls away from eero", async () => {
    const { mesh } = await bridgeSetup();
    await expect(mesh.startLogin("alex@example.com")).rejects.toThrow(/not available/);
    await expect(mesh.verify("123456")).rejects.toThrow(/not available/);
  });
});
