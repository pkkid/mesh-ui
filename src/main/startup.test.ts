import { describe, expect, it } from "vitest";
import { autostartEntry, autostartFile, createStartup, HIDDEN_FLAG, type LoginItems, openedAtLogin, type StartupDeps } from "./startup";

function fakes(over: Partial<StartupDeps> = {}) {
  const files = new Map<string, string>();
  const calls: unknown[] = [];
  let openAtLogin = false;
  const login: LoginItems = {
    get: () => ({ openAtLogin }),
    set: (s) => {
      calls.push(s);
      openAtLogin = s.openAtLogin;
    },
  };
  const deps: StartupDeps = {
    platform: "linux",
    install: "appimage",
    exePath: "/tmp/.mount_mesh/mesh-ui",
    env: { APPIMAGE: "/home/alex/Apps/Mesh UI.AppImage" },
    home: "/home/alex",
    login,
    fs: {
      exists: (p) => files.has(p),
      read: (p) => files.get(p) ?? "",
      write: (p, t) => void files.set(p, t),
      remove: (p) => void files.delete(p),
    },
    ...over,
  };
  return { startup: createStartup(deps), files, calls };
}

const FILE = "/home/alex/.config/autostart/mesh-ui.desktop";

describe("start at login", () => {
  it("Linux: writes and removes an XDG autostart entry that starts the AppImage hidden", async () => {
    const { startup, files } = fakes();
    expect(await startup.status()).toEqual({ supported: true, enabled: false });
    expect(await startup.set(true)).toEqual({ supported: true, enabled: true });
    expect(files.get(FILE)).toContain(`Exec="/home/alex/Apps/Mesh UI.AppImage" ${HIDDEN_FLAG}`);
    expect(await startup.set(false)).toEqual({ supported: true, enabled: false });
    expect(files.has(FILE)).toBe(false);
  });

  it("Linux: an entry turned off in the desktop's startup settings reads as off", async () => {
    const { startup, files } = fakes();
    files.set(FILE, "[Desktop Entry]\nExec=mesh-ui\nX-GNOME-Autostart-enabled=false\n");
    expect((await startup.status()).enabled).toBe(false);
    files.set(FILE, "[Desktop Entry]\nExec=mesh-ui\nHidden=true\n");
    expect((await startup.status()).enabled).toBe(false);
  });

  it("Linux: follows XDG_CONFIG_HOME and quotes the installed binary", () => {
    expect(autostartFile({ XDG_CONFIG_HOME: "/data/cfg" }, "/home/alex")).toBe("/data/cfg/autostart/mesh-ui.desktop");
    expect(autostartFile({ XDG_CONFIG_HOME: "relative" }, "/home/alex")).toBe(FILE);
    expect(autostartEntry({ install: "deb", exePath: "/opt/Mesh UI/mesh-ui", env: {} })).toContain('Exec="/opt/Mesh UI/mesh-ui" --hidden');
  });

  it("Windows: a login item for this exe with --hidden", async () => {
    const { startup, calls } = fakes({ platform: "win32", install: "nsis", exePath: "C:\\Mesh UI\\Mesh UI.exe" });
    expect(await startup.set(true)).toEqual({ supported: true, enabled: true });
    expect(calls).toEqual([{ openAtLogin: true, path: "C:\\Mesh UI\\Mesh UI.exe", args: [HIDDEN_FLAG] }]);
  });

  it("macOS: a plain login item", async () => {
    const { startup, calls } = fakes({ platform: "darwin", install: "mac" });
    await startup.set(true);
    await startup.set(false);
    expect(calls).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });

  it("a development build is not supported and changes nothing", async () => {
    const { startup, files, calls } = fakes({ install: "dev" });
    expect(await startup.set(true)).toEqual({ supported: false, enabled: false });
    expect(files.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("knows a login launch", () => {
    const login = { get: () => ({ openAtLogin: true, wasOpenedAtLogin: true }) };
    expect(openedAtLogin("linux", ["mesh-ui", HIDDEN_FLAG], login)).toBe(true);
    expect(openedAtLogin("win32", ["Mesh UI.exe"], login)).toBe(false);
    expect(openedAtLogin("darwin", ["Mesh UI"], login)).toBe(true);
  });
});
