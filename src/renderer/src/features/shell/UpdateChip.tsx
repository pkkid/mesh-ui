/**
 * The sidebar footer's "Restart to update" chip
 * (docs/platform/build-and-release.md#auto-update). Stub until M6.5: it
 * shows only when `app.info` reports a downloaded update and links to About
 * on App & account, where the update is installed.
 */
import { Download } from "lucide-react";

import { Link } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import type { AppInfo } from "../../../../core/model";

export function UpdateChip() {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const update = info.data?.update;
  if (update?.state !== "ready") return null;
  return (
    <Link
      to="/account/about"
      className="mb-1 flex items-center gap-2 rounded-[var(--control-radius)] border px-2.5 py-1.5 text-xs outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Download className="size-3.5 text-muted-foreground" />
      <span className="flex-1">Restart to update</span>
      {update.version && <span className="text-2xs text-muted-foreground tabular-nums">{update.version}</span>}
    </Link>
  );
}
