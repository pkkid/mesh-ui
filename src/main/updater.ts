/**
 * The auto-updater (electron-updater, docs/platform/build-and-release.md#auto-update).
 * Stub until M6.5: every install kind reports `unsupported` and a check
 * changes nothing, so `app.info`, `app.update.check` and the UpdateChip
 * have a contract to build on.
 */

import { CommandError } from "../core/errors";
import type { InstallKind, UpdateChannel, UpdateStatus } from "../core/model";
import type { HostActions } from "../core/spec";

export type UpdaterDeps = {
  install: InstallKind;
  /** The channel from app settings, read when the status is asked for. */
  channel(): Promise<UpdateChannel>;
};

export function createUpdater(deps: UpdaterDeps): NonNullable<HostActions["update"]> {
  const status = async (): Promise<UpdateStatus> => ({ state: "unsupported", version: null, channel: await deps.channel(), checkedAt: null, progress: null, error: null });
  return {
    status,
    check: status,
    install: async () => {
      throw new CommandError("bad_params", "No update is ready to install.");
    },
  };
}
