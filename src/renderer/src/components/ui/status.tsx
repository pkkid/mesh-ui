// Status from docs/design/design-system.md (Components) and the status
// vocabulary in docs/ux/overview.md#status-vocabulary: a dot in the status
// colour plus plain text. No pill outline, fill or uppercase.
import type * as React from "react";

import type { Status as ModelStatus } from "../../../../core/model";
import { cn } from "~/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "muted";

const DOT: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  muted: "bg-muted-foreground/60",
};

function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[tone], className)} />;
}

type StatusProps = React.ComponentProps<"span"> & { tone: StatusTone };

/** "Online", "Weak link": the dot plus a `text-xs` label in `text-foreground/80`. */
function Status({ tone, className, children, ...props }: StatusProps) {
  return (
    <span
      data-slot="status"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-xs",
        tone === "muted" ? "text-muted-foreground" : "text-foreground/80",
        className,
      )}
      {...props}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** Words and tone for a network or eero status. */
const NETWORK_STATUS: Record<ModelStatus, { tone: StatusTone; label: string }> = {
  online: { tone: "success", label: "Online" },
  degraded: { tone: "warning", label: "Weak link" },
  offline: { tone: "destructive", label: "Offline" },
  updating: { tone: "info", label: "Updating" },
  unknown: { tone: "muted", label: "Unknown" },
};

function networkStatus(status: ModelStatus | null | undefined): { tone: StatusTone; label: string } {
  return NETWORK_STATUS[status ?? "unknown"];
}

export { networkStatus, Status, StatusDot };
