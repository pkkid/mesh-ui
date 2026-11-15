/**
 * The host actions the window's engine gets (`HostInfo.actions` in
 * src/core/spec.ts): the updater, the CLI installer and relaunching into
 * demo mode. Only the window has them; the CLI and MCP hosts get none, so
 * those commands answer "Only in the Mesh UI window." there.
 */

import type { InstallKind, UpdateChannel } from "../core/model";
import type { HostActions } from "../core/spec";
import { createCliInstaller } from "./cli-install";
import { createDemoSwitch } from "./demo-switch";
import { createUpdater } from "./updater";

export type HostActionDeps = {
  install: InstallKind;
  exePath: string;
  env: Readonly<Record<string, string | undefined>>;
  channel(): Promise<UpdateChannel>;
};

export function createHostActions(d: HostActionDeps): HostActions {
  return {
    update: createUpdater({ install: d.install, channel: d.channel }),
    cli: createCliInstaller({ install: d.install, exePath: d.exePath, env: d.env }),
    relaunch: createDemoSwitch(),
  };
}
