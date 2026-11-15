import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../core/errors";
import { appImageScript, createCliInstaller, MAC_INSTALL_SCRIPT, macInstallArgs, pathLine, type Runner } from "./cli-install";

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mesh-ui-M6.6-cli-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const posix = process.platform !== "win32";

// AppImages exist only on Linux, and the launcher paths are POSIX paths.
describe.runIf(posix)("AppImage", () => {
  const appImage = "/opt/apps/Mesh UI's \"build\"/Mesh-UI-0.1.0-x86_64.AppImage";
  /** The AppImage runtime mounts the image at APPDIR and runs the exe from inside it. */
  const mount = { APPDIR: "/tmp/.mount_MeshUIab12", exePath: "/tmp/.mount_MeshUIab12/mesh-ui" };
  const local = () => path.join(home, ".local", "bin");

  it("writes an executable launcher and warns when ~/.local/bin is not on PATH", async () => {
    const cli = createCliInstaller({ install: "appimage", exePath: mount.exePath, env: { APPIMAGE: appImage, APPDIR: mount.APPDIR, PATH: "/usr/bin:/bin" }, home });
    expect(await cli.status()).toMatchObject({ installed: false, canInstall: true, onPath: false, reinstall: false });

    const s = await cli.install();
    const file = path.join(local(), "mesh-ui");
    expect(s).toMatchObject({ installed: true, path: file, onPath: false, canInstall: true, reinstall: false });
    expect(s.pathLine).toBe(`export PATH="${local()}:$PATH"`);
    expect(readFileSync(file, "utf8")).toBe(appImageScript(appImage));
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o755);
  });

  it("is on PATH when ~/.local/bin is", async () => {
    const cli = createCliInstaller({ install: "appimage", exePath: mount.exePath, env: { APPIMAGE: appImage, APPDIR: mount.APPDIR, PATH: `/usr/bin:${local()}/` }, home });
    expect(await cli.install()).toMatchObject({ installed: true, onPath: true, pathLine: null });
  });

  it("the script runs the AppImage headless with every argument unchanged", () => {
    // A stand-in AppImage that prints its argv and display vars.
    const fake = path.join(home, "dir with 'quote\" and $HOME", "fake.AppImage");
    mkdirSync(path.dirname(fake), { recursive: true });
    writeFileSync(fake, '#!/bin/sh\necho "D=${DISPLAY-unset} W=${WAYLAND_DISPLAY-unset}"\nfor a in "$@"; do echo "[$a]"; done\n');
    chmodSync(fake, 0o755);
    const launcher = path.join(home, "launcher");
    writeFileSync(launcher, appImageScript(fake), { mode: 0o755 });
    const out = execFileSync(launcher, ["run", "app.info", "two  spaces", "it's", "$HOME"], { env: { PATH: process.env.PATH, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" }, encoding: "utf8" });
    expect(out.split("\n").filter(Boolean)).toEqual([
      "D=unset W=unset",
      "[--cli]",
      "[--ozone-platform=headless]",
      "[--disable-gpu]",
      "[run]",
      "[app.info]",
      "[two  spaces]",
      "[it's]",
      "[$HOME]",
    ]);
  });

  it("asks for Reinstall when the AppImage moved, and Reinstall fixes it", async () => {
    await createCliInstaller({ install: "appimage", exePath: mount.exePath, env: { APPIMAGE: "/old/Mesh.AppImage", APPDIR: mount.APPDIR }, home }).install();
    const moved = createCliInstaller({ install: "appimage", exePath: mount.exePath, env: { APPIMAGE: "/new/Mesh.AppImage", APPDIR: mount.APPDIR }, home });
    expect(await moved.status()).toMatchObject({ installed: true, reinstall: true });
    expect(await moved.install()).toMatchObject({ installed: true, reinstall: false });
    expect(readFileSync(path.join(local(), "mesh-ui"), "utf8")).toContain("'/new/Mesh.AppImage'");
  });

  it.each([
    ["no APPIMAGE", {}],
    ["no APPDIR", { APPIMAGE: appImage }],
    // Started from a terminal inside another AppImage: its APPIMAGE and APPDIR leak in.
    ["another app's AppImage", { APPIMAGE: "/home/pat/Apps/Editor.AppImage", APPDIR: "/tmp/.mount_EditorZZ" }],
  ])("offers no install and writes nothing with %s", async (_name, env) => {
    const cli = createCliInstaller({ install: "appimage", exePath: mount.exePath, env, home });
    expect(await cli.status()).toMatchObject({ canInstall: false, installed: false });
    await expect(cli.install()).rejects.toBeInstanceOf(CommandError);
    expect(() => statSync(local())).toThrow();
  });
});

describe("macOS", () => {
  const app = "/Applications/My \"Apps\" it's/Mesh UI.app";
  const exePath = `${app}/Contents/MacOS/Mesh UI`;
  const bundled = `${app}/Contents/Resources/bin/mesh-ui`;
  const link = "/usr/local/bin/mesh-ui";

  /** A fake /usr/local/bin and /etc/paths: the runner "creates" the link. */
  function mac(opts: { linkTo?: string | null; etcPaths?: string; env?: Record<string, string>; runner?: Runner } = {}) {
    let linkTo = opts.linkTo ?? null;
    const runner = vi.fn<Runner>(
      opts.runner ??
        (async (_file, args) => {
          linkTo = args[args.length - 3] ?? null;
        }),
    );
    const cli = createCliInstaller({
      install: "mac",
      exePath,
      env: opts.env ?? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      fs: {
        exists: (f) => f === link && linkTo !== null,
        readLink: (f) => (f === link ? linkTo : null),
        readText: (f) => (f === "/etc/paths" ? (opts.etcPaths ?? "/usr/local/bin\n/usr/bin\n/bin\n") : null),
        mkdirp: () => {
          throw new Error("no direct writes on macOS");
        },
        writeExecutable: () => {
          throw new Error("no direct writes on macOS");
        },
      },
      runPrivileged: runner,
    });
    return { cli, runner };
  }

  it("calls osascript with the paths as separate arguments, never inside the script", async () => {
    const { cli, runner } = mac();
    expect(await cli.status()).toMatchObject({ installed: false, canInstall: true, path: link, reinstall: false });
    const s = await cli.install();
    expect(runner).toHaveBeenCalledTimes(1);
    const [file, args] = runner.mock.calls[0] ?? [];
    expect(file).toBe("/usr/bin/osascript");
    expect(args).toEqual([...MAC_INSTALL_SCRIPT.flatMap((l) => ["-e", l]), bundled, link, "/usr/local/bin"]);
    // The script text is fixed: no path, quote or space from the app's location is in it.
    for (const line of MAC_INSTALL_SCRIPT) {
      expect(line).not.toContain("Applications");
      expect(line).not.toContain("mesh-ui");
    }
    expect(MAC_INSTALL_SCRIPT.join("\n")).toContain("with administrator privileges");
    expect(MAC_INSTALL_SCRIPT.join("\n")).toMatch(/quoted form of \(item 1 of argv\)/);
    expect(s).toMatchObject({ installed: true, reinstall: false, onPath: true, pathLine: null });
  });

  it("counts /etc/paths, since an app opened from Finder has a short PATH", async () => {
    const { cli } = mac({ linkTo: bundled, etcPaths: "/usr/bin\n/bin\n" });
    const s = await cli.status();
    expect(s.onPath).toBe(false);
    expect(s.pathLine).toBe(`export PATH="${app.replace(/"/g, '\\"')}/Contents/Resources/bin:$PATH"`);
  });

  it("offers the PATH line and stays not installed when the admin prompt is declined", async () => {
    const { cli } = mac({
      runner: async () => {
        throw new Error("execution error: User canceled. (-128)");
      },
    });
    const s = await cli.install();
    expect(s).toMatchObject({ installed: false, onPath: false });
    expect(s.pathLine).toContain("/Contents/Resources/bin:$PATH");
  });

  it("answers bad_params when osascript fails for another reason", async () => {
    const { cli } = mac({
      runner: async () => {
        throw new Error("ln: /usr/local/bin/mesh-ui: Read-only file system");
      },
    });
    await expect(cli.install()).rejects.toMatchObject({ code: "bad_params" });
  });

  it("asks for Reinstall when the link points at an app that moved", async () => {
    const { cli, runner } = mac({ linkTo: "/Users/me/Downloads/Mesh UI.app/Contents/Resources/bin/mesh-ui" });
    const stale = await cli.status();
    expect(stale).toMatchObject({ installed: true, reinstall: true });
    // The old link may dangle, so the bundle's PATH line stays on offer until Reinstall.
    expect(stale.pathLine).toContain("/Contents/Resources/bin:$PATH");
    expect(await cli.install()).toMatchObject({ installed: true, reinstall: false, pathLine: null });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("the osascript argv round-trips paths with spaces and quotes", () => {
    const args = macInstallArgs(bundled, link);
    expect(args.slice(-3)).toEqual([bundled, link, "/usr/local/bin"]);
  });
});

describe("installers and portable only report", () => {
  const never: Runner = async () => {
    throw new Error("must not run");
  };
  const noWrites = {
    mkdirp: () => {
      throw new Error("must not write");
    },
    writeExecutable: () => {
      throw new Error("must not write");
    },
  };

  it.each(["deb", "rpm"] as const)("%s reports /usr/bin/mesh-ui", async (install) => {
    const cli = createCliInstaller({ install, exePath: "/opt/Mesh UI/mesh-ui", env: { PATH: "/usr/local/bin:/usr/bin" }, home, fs: { ...noWrites, exists: (f) => f === "/usr/bin/mesh-ui" }, runPrivileged: never });
    const expected = { installed: true, path: "/usr/bin/mesh-ui", onPath: true, canInstall: false, reinstall: false, pathLine: null };
    expect(await cli.status()).toEqual(expected);
    expect(await cli.install()).toEqual(expected);
  });

  it("nsis reports the launcher the installer put on the user PATH (case-insensitive)", async () => {
    const exePath = "C:\\Users\\Pat\\AppData\\Local\\Programs\\Mesh UI\\Mesh UI.exe";
    const launcher = "C:\\Users\\Pat\\AppData\\Local\\Programs\\Mesh UI\\bin\\mesh-ui.cmd";
    const cli = createCliInstaller({ install: "nsis", platform: "win32", exePath, env: { PATH: "C:\\Windows;c:\\users\\pat\\appdata\\local\\programs\\mesh ui\\bin\\" }, home, fs: { ...noWrites, exists: (f) => f === launcher }, runPrivileged: never });
    expect(await cli.install()).toEqual({ installed: true, path: launcher, onPath: true, canInstall: false, reinstall: false, pathLine: null });
  });

  it("portable reports its bin folder and the PowerShell line to add it", async () => {
    const exePath = "D:\\Tools\\Mesh UI\\Mesh UI.exe";
    const launcher = "D:\\Tools\\Mesh UI\\bin\\mesh-ui.cmd";
    const cli = createCliInstaller({ install: "portable", platform: "win32", exePath, env: { PATH: "C:\\Windows" }, home, fs: { ...noWrites, exists: (f) => f === launcher }, runPrivileged: never });
    const s = await cli.install();
    expect(s).toMatchObject({ installed: true, path: launcher, onPath: false, canInstall: false, reinstall: false });
    expect(s.pathLine).toBe(pathLine("D:\\Tools\\Mesh UI\\bin", true));
    expect(s.pathLine).toContain('+ ";D:\\Tools\\Mesh UI\\bin", "User")');
  });

  it("an unpacked build on Linux or macOS has no launcher of its own", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const cli = createCliInstaller({ install: "portable", platform, exePath: "/home/pat/Mesh UI/linux-unpacked/mesh-ui", env: { PATH: "/usr/bin" }, home, fs: noWrites, runPrivileged: never });
      expect(await cli.install()).toEqual({ installed: false, path: null, onPath: false, canInstall: false, reinstall: false, pathLine: null });
    }
  });

  it("dev has no launcher", async () => {
    const cli = createCliInstaller({ install: "dev", exePath: "/x/electron", env: { PATH: "/usr/bin" }, home, fs: noWrites, runPrivileged: never });
    expect(await cli.install()).toEqual({ installed: false, path: null, onPath: false, canInstall: false, reinstall: false, pathLine: null });
  });
});

describe("pathLine", () => {
  it("escapes shell and PowerShell specials", () => {
    expect(pathLine('/a "b" $c `d` \\e', false)).toBe('export PATH="/a \\"b\\" \\$c \\`d\\` \\\\e:$PATH"');
    expect(pathLine('C:\\a $b "c"', true)).toContain(';C:\\a `$b `"c`"",');
  });

  it.runIf(posix)("the shell line really puts the folder first on PATH", () => {
    const dir = path.join(home, 'odd "dir" $x');
    const out = execFileSync("/bin/sh", ["-c", `${pathLine(dir, false)}; printf %s "$PATH"`], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    expect(out).toBe(`${dir}:/usr/bin:/bin`);
  });
});
