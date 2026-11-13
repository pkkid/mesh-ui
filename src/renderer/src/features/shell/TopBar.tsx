import type { ReactNode } from "react";

/**
 * The draggable strip at the top of the main pane. It doubles as the window
 * titlebar, so it reserves room for native window controls on the right.
 */
export function TopBar({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-3 border-b px-4 pe-[calc(var(--titlebar-inset-right)+1rem)]">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate font-semibold text-sm">{title}</h1>
        {subtitle && <span className="truncate text-muted-foreground text-xs">{subtitle}</span>}
      </div>
      <div className="no-drag ms-auto flex items-center gap-1">{actions}</div>
    </header>
  );
}
