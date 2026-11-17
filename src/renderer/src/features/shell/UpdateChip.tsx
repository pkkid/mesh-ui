/**
 * The sidebar footer's update chip
 * (docs/platform/build-and-release.md#auto-update): "Restart to update"
 * when `app.info` reports a downloaded update (`ready`), "Update available"
 * when an unsigned macOS build found one it cannot install (`available`).
 * It links to About on Settings & Account, where the update is installed or
 * downloaded. It also follows the
 * updater's `update.changed` host event, so the chip and About change as
 * soon as the state does instead of on the next 60 s poll.
 */
import { Download } from "lucide-react";
import { useEffect } from "react";

import { Link } from "~/app/router";
import { bridge, invalidate, useQuery } from "~/app/useCommand";
import type { AppInfo } from "../../../../core/model";

export function UpdateChip() {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  useEffect(() => {
    const mesh = bridge();
    if (typeof mesh.on !== "function") return;
    return mesh.on((event) => {
      if (event.type === "update.changed") invalidate(["app.info"]);
    });
  }, []);

  const update = info.data?.update;
  if (update?.state !== "ready" && update?.state !== "available") return null;
  return (
    <Link
      to="/account/about"
      className="mb-1 flex items-center gap-2 rounded-[var(--control-radius)] border px-2.5 py-1.5 text-xs outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Download className="size-3.5 text-muted-foreground" />
      <span className="flex-1">{update.state === "ready" ? "Restart to update" : "Update available"}</span>
      {update.version && <span className="text-2xs text-muted-foreground tabular-nums">{update.version}</span>}
    </Link>
  );
}
