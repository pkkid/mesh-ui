import { describe, expect, it } from "vitest";
import { IPC } from "../shared/types";
import { createMeshBridge, type IpcMainLike, type IpcRendererLike, type SenderEvent } from "./ipc";
import { ALERT_MAX_TITLE, checkAlert, type NotifyHost, registerNotify } from "./notify";

const APP = "file:///app/renderer/index.html";

function fakeMain() {
  const on = new Map<string, (e: SenderEvent, ...args: unknown[]) => void>();
  const ipc: IpcMainLike = {
    handle: () => {},
    on: (channel, listener) => void on.set(channel, listener),
    removeHandler: () => {},
    removeAllListeners: (channel) => void on.delete(channel),
  };
  const send = (url: string, payload: unknown) => on.get(IPC.notify)?.({ senderFrame: { url } }, payload);
  return { ipc, on, send };
}

function fakeHost() {
  const shown: { title: string; body: string; click: () => void }[] = [];
  const opened: string[] = [];
  const host: NotifyHost = {
    show: (alert, onClick) => void shown.push({ ...alert, click: onClick }),
    open: (target) => void opened.push(target),
  };
  return { host, shown, opened };
}

describe("mesh:notify", () => {
  it("shows one host notification per alert and opens its target on click", () => {
    const { ipc, on, send } = fakeMain();
    const { host, shown, opened } = fakeHost();
    const off = registerNotify(ipc, (e) => e.senderFrame?.url === APP, host);

    send(APP, { title: "Garage is offline", body: "Garage stopped checking in.", target: "/eeros" });
    send(APP, { title: "New device joined", body: "", target: "/devices/0a1b2c3d4e5f" });
    expect(shown.map((s) => s.title)).toEqual(["Garage is offline", "New device joined"]);
    expect(opened).toEqual([]);
    shown[0]?.click();
    expect(opened).toEqual(["/eeros"]);

    off();
    expect(on.has(IPC.notify)).toBe(false);
  });

  it("refuses other senders and bad alerts", () => {
    const { ipc, send } = fakeMain();
    const { host, shown } = fakeHost();
    registerNotify(ipc, (e) => e.senderFrame?.url === APP, host);
    send("https://example.com/", { title: "x", body: "", target: "/eeros" });
    send(APP, { title: "x", body: "", target: "https://example.com/" });
    send(APP, { title: "x", body: "", target: "/../etc" });
    send(APP, { title: "  ", body: "", target: "/eeros" });
    send(APP, "not an object");
    expect(shown).toEqual([]);
  });

  it("clips long text and survives a host without a notification service", () => {
    expect(checkAlert({ title: "t".repeat(500), body: "b", target: "/activity" })?.title).toHaveLength(ALERT_MAX_TITLE);
    const { ipc, send } = fakeMain();
    registerNotify(ipc, () => true, {
      show: () => {
        throw new Error("no service");
      },
      open: () => {},
    });
    expect(() => send(APP, { title: "x", body: "", target: "/eeros" })).not.toThrow();
  });
});

describe("window.mesh notify bridge", () => {
  it("sends alerts and delivers clicks", () => {
    const sent: [string, unknown][] = [];
    const listeners = new Map<string, (e: unknown, ...a: unknown[]) => void>();
    const ipc: IpcRendererLike = {
      invoke: async () => null,
      send: (channel, ...args) => void sent.push([channel, args[0]]),
      on: (channel, l) => listeners.set(channel, l),
      removeListener: (channel) => listeners.delete(channel),
    };
    const mesh = createMeshBridge(ipc, "linux");
    mesh.notify({ title: "Garage is offline", body: "", target: "/eeros" });
    mesh.notify({ title: 1, body: "", target: "/eeros" } as never);
    expect(sent).toEqual([[IPC.notify, { title: "Garage is offline", body: "", target: "/eeros" }]]);

    const clicks: string[] = [];
    const off = mesh.onNotificationClick((t) => clicks.push(t));
    listeners.get(IPC.notifyClick)?.({}, "/eeros");
    listeners.get(IPC.notifyClick)?.({}, 42);
    expect(clicks).toEqual(["/eeros"]);
    off();
    expect(listeners.has(IPC.notifyClick)).toBe(false);
  });
});
