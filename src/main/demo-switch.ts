/**
 * "Try demo mode" and leaving it: relaunches Mesh UI with or without demo
 * fixtures. Stub until M6.8: it answers "not available yet".
 */

import { CommandError } from "../core/errors";
import type { HostActions } from "../core/spec";

export function createDemoSwitch(): NonNullable<HostActions["relaunch"]> {
  return {
    demo: async () => {
      throw new CommandError("bad_params", "Switching demo mode from the window is not available yet.");
    },
  };
}
