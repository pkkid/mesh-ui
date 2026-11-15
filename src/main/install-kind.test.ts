import { describe, expect, it } from "vitest";
import { detectInstallKind, type InstallKindInput } from "./install-kind";

const base: InstallKindInput = {
  packaged: true,
  platform: "linux",
  env: {},
  resourcesPath: "/opt/Mesh UI/resources",
  exePath: "/opt/Mesh UI/mesh-ui",
  readText: () => null,
  list: () => [],
};

describe("detectInstallKind", () => {
  it("is dev when unpackaged, on any OS and whatever the env says", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(detectInstallKind({ ...base, packaged: false, platform, env: { APPIMAGE: "/x.AppImage" }, readText: () => "deb" })).toBe("dev");
    }
  });

  it("is mac for a packaged macOS app", () => {
    expect(detectInstallKind({ ...base, platform: "darwin", exePath: "/Applications/Mesh UI.app/Contents/MacOS/Mesh UI" })).toBe("mac");
  });

  it("is nsis when the uninstaller sits beside the exe, else portable", () => {
    const win = { ...base, platform: "win32" as const, exePath: "C:\\Users\\alex\\AppData\\Local\\Programs\\Mesh UI\\Mesh UI.exe" };
    const seen: string[] = [];
    const list = (dir: string) => {
      seen.push(dir);
      return ["Mesh UI.exe", "Uninstall Mesh UI.exe", "resources"];
    };
    expect(detectInstallKind({ ...win, list })).toBe("nsis");
    expect(seen).toEqual(["C:\\Users\\alex\\AppData\\Local\\Programs\\Mesh UI"]);
    expect(detectInstallKind({ ...win, list: () => ["Mesh UI.exe", "resources"] })).toBe("portable");
  });

  it("is appimage when APPIMAGE is set, before any package-type file", () => {
    expect(detectInstallKind({ ...base, env: { APPIMAGE: "/home/alex/Apps/Mesh-UI.AppImage" }, readText: () => "deb" })).toBe("appimage");
  });

  it("reads deb and rpm from resources/package-type", () => {
    const read = (value: string) => (file: string) => (file === "/opt/Mesh UI/resources/package-type" ? value : null);
    expect(detectInstallKind({ ...base, readText: read("deb\n") })).toBe("deb");
    expect(detectInstallKind({ ...base, readText: read("rpm") })).toBe("rpm");
    // An unknown package type or none (an unpacked build) cannot update itself.
    expect(detectInstallKind({ ...base, readText: read("pacman") })).toBe("portable");
    expect(detectInstallKind(base)).toBe("portable");
  });

  it("ignores an empty APPIMAGE", () => {
    expect(detectInstallKind({ ...base, env: { APPIMAGE: "" }, readText: () => "rpm" })).toBe("rpm");
  });
});
