import { beforeEach, describe, expect, it } from "vitest";

import { createDemoBackend } from "../../../../core/demo";
import { createEngine } from "../../../../core/engine";
import type { Device, DeviceList } from "../../../../core/model";
import type { CommandInfo } from "../../../../core/registry";
import { performWrite, type WriteDeps } from "../../app/useWrite";
import { toast } from "../../components/ui/toast";
import { writeRequest } from "./search";
import { inverseOf, withUndo } from "./undo";

const NOW = Date.parse("2026-11-12T22:41:00Z");

function setup() {
  const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });
  const commands = engine.commands();
  let network: string | null = null;
  const executed: { id: string; params: unknown }[] = [];
  const deps: WriteDeps = {
    execute: (id, params) => (executed.push({ id, params }), engine.execute(id, params)),
    info: async (id) => commands.find((c) => c.id === id),
    ask: async () => true,
    invalidate: () => {},
  };
  const info = (id: string): CommandInfo => {
    const c = commands.find((x) => x.id === id);
    if (!c) throw new Error(`no ${id}`);
    return c;
  };
  const device = async (name: string): Promise<Device> => {
    const r = await engine.execute<DeviceList>("device.list", { search: name });
    const d = r.ok ? r.result.devices.find((x) => x.name === name) : undefined;
    if (!d) throw new Error(`fixture: ${name}`);
    return d;
  };
  /** Runs `id` the way the palette does: writeRequest plus withUndo, through performWrite. */
  const runFromPalette = (id: string, params: Record<string, unknown>) => {
    const c = info(id);
    return performWrite(withUndo(writeRequest(c, c.label, params), c, commands, network), deps);
  };
  const selectedNetwork = async () => {
    const r = await engine.execute<{ id: string }>("network.get", {});
    if (!r.ok) throw new Error(r.error.message);
    network = r.result.id;
    return network;
  };
  return { engine, commands, executed, info, device, runFromPalette, selectedNetwork };
}

describe("palette Undo", () => {
  beforeEach(() => toast.clear());

  it("pairs a write with its registered opposite, and nothing else", () => {
    const t = setup();
    const inv = (id: string) => inverseOf(t.info(id), t.commands)?.id ?? null;
    expect(inv("device.pause")).toBe("device.resume");
    expect(inv("device.resume")).toBe("device.pause");
    expect(inv("device.block")).toBe("device.unblock");
    expect(inv("profile.pause")).toBe("profile.resume");
    expect(inv("profile.unassigned.pause")).toBe("profile.unassigned.resume");
    expect(inv("guest.enable")).toBeNull(); // guest.disable drops guests (disruptive), so no one-click Undo
    expect(inv("device.rename")).toBeNull();
    expect(inv("network.restart")).toBeNull(); // disruptive: no Undo
    expect(inv("device.list")).toBeNull();
  });

  it("toasts a palette device.pause with Undo, and Undo resumes the device", async () => {
    const t = setup();
    const net = await t.selectedNetwork();
    const res = await t.runFromPalette("device.pause", { devices: "PlayStation 5" });
    expect(t.executed[0]).toEqual({ id: "device.pause", params: { networkId: net, devices: "PlayStation 5" } });
    expect(res).toMatchObject({ ok: true });
    expect((await t.device("PlayStation 5")).paused).toBe(true);
    const [done] = toast.list();
    expect(done).toMatchObject({ kind: "success", title: "Done: Pause device, PlayStation 5", action: { label: "Undo" } });

    await done?.action?.run();
    const id = (await t.device("PlayStation 5")).id;
    // Undo names the network the pause ran on, so a network switch in between does not move it.
    expect(t.executed.at(-1)).toEqual({ id: "device.resume", params: { devices: [id], networkId: net } });
    expect((await t.device("PlayStation 5")).paused).toBe(false);
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Undone: Pause device" }]);
  });

  it("undoes only the devices that changed, and offers no Undo when none did", async () => {
    const t = setup();
    const ps5 = await t.device("PlayStation 5");
    await t.runFromPalette("device.block", { devices: ["PlayStation 5", "Flaky Plug"] });
    await toast.list()[0]?.action?.run();
    expect(t.executed.at(-1)).toMatchObject({ id: "device.unblock", params: { devices: [ps5.id] } });

    toast.clear();
    await t.runFromPalette("device.pause", { devices: ["Flaky Plug"] });
    expect(toast.list()).toMatchObject([{ kind: "error" }]);
    expect(toast.list()[0]?.action?.label).toBe("Retry");
  });

  it("keeps a write without an inverse as it was", async () => {
    const t = setup();
    await t.runFromPalette("device.rename", { device: "PlayStation 5", nickname: "Den console" });
    expect(toast.list()).toMatchObject([{ kind: "success" }]);
    expect(toast.list()[0]?.action).toBeUndefined();
  });
});
