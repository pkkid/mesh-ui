// The page header (hero) every page opens with, from
// docs/design/design-system.md (Layout, Page header) and mockups 01 to 08:
// icon or avatar top-aligned with the title, a status line, key facts, then
// the actions in a row at the bottom. Big figures, gauges or a QR block sit
// on the right (`aside`).
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

type PageHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  /** A lucide icon for a neutral 64px tile, or any node (an avatar). */
  icon?: LucideIcon | React.ReactNode;
  /** The line under the title: usually a <Status> then muted context. */
  status?: React.ReactNode;
  /** Key facts, usually <Metric>s. */
  facts?: React.ReactNode;
  /** Buttons, primary first, disruptive last. */
  actions?: React.ReactNode;
  /** Right-hand column: hero figures, gauges, QR block. */
  aside?: React.ReactNode;
};

function isIcon(icon: unknown): icon is LucideIcon {
  // lucide icons are forwardRef objects or functions; React elements have $$typeof element.
  return typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in icon);
}

function PageHeader({ title, icon, status, facts, actions, aside, className, ...props }: PageHeaderProps) {
  const Icon = isIcon(icon) ? icon : null;
  return (
    <div data-slot="page-header" className={cn("rounded-(--hero-radius) border bg-card", className)} {...props}>
      <div className="flex items-center gap-7 px-6 py-[22px]">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {Icon ? <IconTile icon={Icon} size="xl" /> : (icon as React.ReactNode)}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h2 className="truncate font-semibold text-[28px] leading-tight tracking-tight">{title}</h2>
              {status && <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">{status}</div>}
            </div>
            {facts && <div className="flex flex-wrap gap-x-[22px] gap-y-2">{facts}</div>}
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-7">{aside}</div>}
      </div>
    </div>
  );
}

/** Label over value, as in the header facts and metric rows. Missing values show "-". */
function Metric({
  label,
  value,
  mono = false,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn("truncate font-medium text-base tabular-nums", mono && "font-mono text-sm")}>
        {missing ? "-" : value}
      </div>
    </div>
  );
}

const TILE = {
  sm: "size-6 rounded-[7px] [&_svg]:size-3.5",
  md: "size-8 rounded-[9px] [&_svg]:size-4",
  lg: "size-11 rounded-xl [&_svg]:size-[22px]",
  xl: "size-16 rounded-(--hero-radius) [&_svg]:size-[30px]",
} as const;

/** A neutral square with an inset border and a muted icon. */
function IconTile({ icon: Icon, size = "md", className }: { icon: LucideIcon; size?: keyof typeof TILE; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]",
        TILE[size],
        className,
      )}
    >
      <Icon />
    </div>
  );
}

export { IconTile, Metric, PageHeader };
