import { describe, expect, it } from "vitest";
import { detectInstallKind, ownAppImage, type InstallKindInput } from "./install-kind";

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

  /** The AppImage runtime mounts the image at APPDIR and runs the exe from inside it. */
  const image = { APPIMAGE: "/home/alex/Apps/Mesh-UI.AppImage", APPDIR: "/tmp/.mount_MeshUIab12" };

  it("is appimage when APPDIR holds the exe, before any package-type file", () => {
    expect(detectInstallKind({ ...base, env: image, exePath: "/tmp/.mount_MeshUIab12/mesh-ui", readText: () => "deb" })).toBe("appimage");
  });

  it("ignores APPIMAGE and APPDIR inherited from another AppImage", () => {
    // A terminal started from another AppImage passes its APPIMAGE and APPDIR on.
    const inherited = { APPIMAGE: "/home/alex/Apps/Editor.AppImage", APPDIR: "/tmp/.mount_EditorZZ" };
    const read = (value: string) => (file: string) => (file === "/opt/Mesh UI/resources/package-type" ? value : null);
    expect(detectInstallKind({ ...base, env: inherited, readText: read("deb") })).toBe("deb");
    expect(detectInstallKind({ ...base, env: inherited, readText: read("rpm") })).toBe("rpm");
    expect(detectInstallKind({ ...base, env: inherited })).toBe("portable");
    // APPIMAGE without APPDIR is not enough either.
    expect(detectInstallKind({ ...base, env: { APPIMAGE: image.APPIMAGE }, readText: read("deb") })).toBe("deb");
    // Dev, macOS and Windows never look at them.
    expect(detectInstallKind({ ...base, packaged: false, env: inherited })).toBe("dev");
    expect(detectInstallKind({ ...base, platform: "darwin", env: inherited })).toBe("mac");
    const win = { ...base, platform: "win32" as const, env: inherited, exePath: "C:\\Mesh UI\\Mesh UI.exe" };
    expect(detectInstallKind({ ...win, list: () => ["Uninstall Mesh UI.exe"] })).toBe("nsis");
    expect(detectInstallKind(win)).toBe("portable");
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

describe("ownAppImage", () => {
  const APPIMAGE = "/home/alex/Apps/Mesh-UI.AppImage";

  it("is the image when APPDIR holds the exe, at any depth", () => {
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/.mount_abc/mesh-ui")).toBe(APPIMAGE);
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/.mount_abc/usr/bin/mesh-ui")).toBe(APPIMAGE);
  });

  it("allows trailing slashes and dot segments", () => {
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc/" }, "/tmp/.mount_abc/mesh-ui")).toBe(APPIMAGE);
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc//" }, "/tmp/.mount_abc/./mesh-ui")).toBe(APPIMAGE);
  });

  it("is null for a folder that only shares a prefix", () => {
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/.mount_abcd/mesh-ui")).toBeNull();
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abcd" }, "/tmp/.mount_abc/mesh-ui")).toBeNull();
  });

  it("is null when the exe is APPDIR itself, above it, or escapes it", () => {
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/.mount_abc")).toBeNull();
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/mesh-ui")).toBeNull();
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "/tmp/.mount_abc/../.mount_xyz/mesh-ui")).toBeNull();
  });

  it("is null when APPIMAGE or APPDIR is missing or empty", () => {
    const exe = "/tmp/.mount_abc/mesh-ui";
    expect(ownAppImage({ APPDIR: "/tmp/.mount_abc" }, exe)).toBeNull();
    expect(ownAppImage({ APPIMAGE }, exe)).toBeNull();
    expect(ownAppImage({ APPIMAGE: "", APPDIR: "/tmp/.mount_abc" }, exe)).toBeNull();
    expect(ownAppImage({ APPIMAGE, APPDIR: "" }, exe)).toBeNull();
  });

  it("is null for a Windows exe path, which no AppImage mount can hold", () => {
    expect(ownAppImage({ APPIMAGE, APPDIR: "/tmp/.mount_abc" }, "C:\\Mesh UI\\Mesh UI.exe")).toBeNull();
  });
});
