/**
 * app: about Mesh UI itself. No eero calls and no session needed. Updating,
 * installing the CLI and switching to demo mode need the window's host
 * actions (`ctx.host.actions`); without them (CLI, MCP) they answer
 * `bad_params` "Only in the Mesh UI window."
 * See docs/architecture/commands.md#app.
 */

import { join } from "node:path";
import { z } from "zod";
import { readAudit } from "../audit";
import { CommandError } from "../errors";
import type { AppInfo, AppSettings, AuditList, CliStatus, UpdateStatus } from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, HOST_ONLY, type HostActions } from "../spec";

const OS = new Set(["darwin", "win32", "linux"]);

/** The host action a command needs, or bad_params where the host has none (CLI, MCP). */
function action<K extends keyof HostActions>(ctx: CommandContext, key: K): NonNullable<HostActions[K]> {
  const a = ctx.host.actions?.[key];
  if (!a) throw new CommandError("bad_params", HOST_ONLY);
  return a as NonNullable<HostActions[K]>;
}

/** The updater's state, or `unsupported` where the host has no updater (CLI, MCP, tests). */
async function updateStatus(ctx: CommandContext): Promise<UpdateStatus> {
  const updater = ctx.host.actions?.update;
  if (updater) return updater.status();
  const { updateChannel } = await ctx.settings.get();
  return { state: "unsupported", version: null, channel: updateChannel, checkedAt: null, progress: null, error: null };
}

/** The settings `app.settings.set` changes. Plan speeds and desktop alerts have their own commands. */
const settingsPatch = z.object({
  userAgent: z.string().trim().min(1).max(300).nullable().optional().describe("User-Agent sent to eero; null for the default. Applies on the next launch."),
  openOnLaunch: z.string().trim().min(1).nullable().optional().describe("Network id to open on launch; null for the last used one."),
  autoUpdate: z.boolean().optional().describe("Check for updates 10 s after launch and every 6 hours."),
  updateChannel: z.enum(["latest", "beta"]).optional().describe("Update channel: latest, or beta for pre-releases."),
  runInTray: z
    .boolean()
    .optional()
    .describe("Keep running in the system tray: closing (and on Windows and Linux minimizing) hides the window, so desktop alerts keep arriving. Takes effect at once in the window."),
});

export const commands: AnyCommand[] = [
  defineCommand({
    id: "app.info",
    label: "About",
    description:
      "Mesh UI version, Electron, OS and architecture, how it was installed, the update state, the command line tool, the active backend, where the session is kept, and the config folder.",
    icon: "info",
    params: z.object({}),
    effect: "query",
    scope: "app",
    poll: POLL.app,
    run: async (ctx): Promise<AppInfo> => {
      const auth = await ctx.backend.auth.status();
      const cli: CliStatus | null = ctx.host.actions?.cli ? await ctx.host.actions.cli.status() : null;
      const tray = ctx.host.actions?.tray ? await ctx.host.actions.tray.available() : null;
      return {
        version: ctx.host.version,
        electron: ctx.host.electron,
        os: (OS.has(process.platform) ? process.platform : "linux") as AppInfo["os"],
        arch: process.arch,
        backend: ctx.backend.kind,
        fakeServer: ctx.backend.fake === true,
        sessionStorage: auth.storage,
        keychainName: auth.storage === "keychain" ? ctx.host.keychainName : null,
        install: ctx.host.install,
        update: await updateStatus(ctx),
        cli,
        tray,
        configDir: ctx.host.configDir ?? "",
      };
    },
  }),

  defineCommand({
    id: "app.settings.get",
    label: "App settings",
    description: "Mesh UI's own settings on this computer (settings.json): User-Agent, plan speeds, desktop alerts, network to open, automatic updates and channel, and keep running in the tray.",
    icon: "settings",
    params: z.object({}),
    effect: "query",
    scope: "app",
    run: (ctx): Promise<AppSettings> => ctx.settings.get(),
  }),

  defineCommand({
    id: "app.settings.set",
    label: "Change app settings",
    description: "Changes Mesh UI's own settings on this computer: User-Agent, network to open on launch, automatic updates, update channel and keep running in the tray. Nothing changes on eero.",
    icon: "settings",
    params: settingsPatch,
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: async (ctx, p): Promise<AppSettings> => {
      const patch = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<AppSettings>;
      if (Object.keys(patch).length === 0) throw new CommandError("bad_params", "Give at least one setting to change.");
      const next = await ctx.settings.update(patch);
      // The window shows or removes its tray icon at once; other hosts pick it up on the next launch.
      if (patch.runInTray !== undefined) await ctx.host.actions?.tray?.apply(next.runInTray);
      return next;
    },
  }),

  defineCommand({
    id: "app.audit.list",
    label: "Recent CLI and agent commands",
    description: "Commands run from the command line and MCP agents this week, from the audit log: newest first, a count per day, and how many were refused for want of confirm.",
    icon: "terminal",
    params: z.object({ limit: z.number().int().min(1).max(200).optional().describe("Most entries to list (default 20).") }),
    effect: "query",
    scope: "app",
    poll: POLL.app,
    run: (ctx, p): Promise<AuditList> =>
      readAudit(ctx.host.configDir ? join(ctx.host.configDir, "audit.jsonl") : null, { now: ctx.now(), limit: p.limit ?? 20 }),
  }),

  defineCommand({
    id: "app.cli.install",
    label: "Install command line tool",
    description: "Puts the mesh-ui command on PATH: a link in /usr/local/bin on macOS, ~/.local/bin for the AppImage. Installers do it themselves. Only in the Mesh UI window.",
    icon: "terminal",
    params: z.object({}),
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: (ctx): Promise<CliStatus> => action(ctx, "cli").install(),
  }),

  defineCommand({
    id: "app.update.check",
    label: "Check for updates",
    description: "Checks for a new version of Mesh UI now. Only in the Mesh UI window.",
    icon: "refresh-cw",
    params: z.object({}),
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: (ctx): Promise<UpdateStatus> => action(ctx, "update").check(),
  }),

  defineCommand({
    id: "app.update.install",
    label: "Restart to update",
    description: "Restarts Mesh UI to install the update it downloaded. Restarts this app only; your network is not touched. Only in the Mesh UI window.",
    icon: "download",
    params: z.object({}),
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: async (ctx): Promise<{ restarting: true; version: string | null }> => {
      const updater = action(ctx, "update");
      const status = await updater.status();
      if (status.state !== "ready") throw new CommandError("bad_params", "No update is ready to install.");
      await updater.install();
      return { restarting: true, version: status.version };
    },
  }),

  defineCommand({
    id: "app.log.show",
    label: "Show eero request log",
    description:
      "Opens the folder holding eero-requests.jsonl, the log of every eero request (redacted path, HTTP status, eero error code, outcome; never a token, name, MAC or IP), to attach to a bug report. Only in the Mesh UI window.",
    icon: "scroll-text",
    params: z.object({}),
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: (ctx): Promise<{ path: string; exists: boolean }> => action(ctx, "logs").showRequestLog(),
  }),

  defineCommand({
    id: "app.demo.set",
    label: "Demo mode",
    description: "Restarts Mesh UI in demo mode (invented networks, nothing real changes) or back to your eero account. Only in the Mesh UI window.",
    icon: "flask-conical",
    params: z.object({ enabled: z.boolean().describe("true for demo mode, false for your eero account.") }),
    effect: "write",
    gate: { area: null },
    scope: "app",
    run: async (ctx, { enabled }): Promise<{ demo: boolean; restarting: boolean }> => {
      const relaunch = action(ctx, "relaunch");
      if (enabled === (ctx.backend.kind === "demo")) return { demo: enabled, restarting: false };
      await relaunch.demo(enabled);
      return { demo: enabled, restarting: true };
    },
  }),
];
