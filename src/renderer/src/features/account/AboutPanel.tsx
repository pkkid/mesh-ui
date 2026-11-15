/**
 * App & account side panel, About (docs/ux/pages/app-account.md, Side panel 1).
 * Skeleton from M6.1: name and version from `app.info`. M6.5 adds update
 * status, the channel switch and the links.
 */
import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import type { AppInfo } from "../../../../core/model";

export function AboutPanel({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  return (
    <Card padded id={id}>
      <div className="font-medium text-sm">Mesh UI</div>
      <div className="mt-0.5 text-muted-foreground text-xs tabular-nums">Version {info.data?.version ?? "-"}</div>
      <p className="mt-3 text-muted-foreground text-xs">Mesh UI is an independent app and is not made by eero or Amazon.</p>
    </Card>
  );
}
