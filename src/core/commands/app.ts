/**
 * app: about Mesh UI itself. No eero calls and no session needed.
 * See docs/architecture/commands.md#app.
 */

import { z } from "zod";
import type { AppInfo } from "../model";
import { type AnyCommand, defineCommand } from "../spec";

const OS = new Set(["darwin", "win32", "linux"]);

export const commands: AnyCommand[] = [
  defineCommand({
    id: "app.info",
    label: "About",
    description: "Mesh UI version, Electron, OS and architecture, the active backend, where the session is kept, and the config folder.",
    icon: "info",
    params: z.object({}),
    effect: "query",
    scope: "app",
    run: async (ctx): Promise<AppInfo> => {
      const auth = await ctx.backend.auth.status();
      return {
        version: ctx.host.version,
        electron: ctx.host.electron,
        os: (OS.has(process.platform) ? process.platform : "linux") as AppInfo["os"],
        arch: process.arch,
        backend: ctx.backend.kind,
        fakeServer: ctx.backend.fake === true,
        sessionStorage: auth.storage,
        keychainName: auth.storage === "keychain" ? ctx.host.keychainName : null,
        update: null,
        configDir: ctx.host.configDir ?? "",
      };
    },
  }),
];
