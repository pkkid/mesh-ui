import { Network as NetworkIcon, Settings, Wifi } from "lucide-react";
import type { Network } from "@shared/types";

import { cn } from "~/lib/utils";

export type View = { kind: "devices"; networkId: string | null } | { kind: "settings" };

type SidebarProps = {
  networks: Network[];
  activeNetworkId: string | null;
  view: View;
  onNavigate: (view: View) => void;
};

export function Sidebar({ networks, activeNetworkId, view, onNavigate }: SidebarProps) {
  return (
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-e bg-sidebar text-sidebar-foreground">
      <div className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-2 ps-[calc(var(--titlebar-inset-left)+1rem)] pe-4">
        <div className="grid size-5 place-items-center rounded-md bg-brand text-brand-foreground">
          <Wifi className="size-3" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-sm tracking-tight">Mesh UI</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2">
        <SectionLabel>Networks</SectionLabel>
        {networks.map((net) => {
          const online = net.devices.filter((d) => d.connected).length;
          return (
            <SidebarRow
              key={net.id}
              active={view.kind === "devices" && net.id === activeNetworkId}
              onClick={() => onNavigate({ kind: "devices", networkId: net.id })}
              icon={<NetworkIcon />}
              label={net.name}
              meta={online}
            />
          );
        })}
        {networks.length === 0 && <p className="px-2.5 py-1 text-sidebar-muted-foreground text-xs">No networks found</p>}
      </nav>

      <div className="border-sidebar-border border-t p-2">
        <SidebarRow
          active={view.kind === "settings"}
          onClick={() => onNavigate({ kind: "settings" })}
          icon={<Settings />}
          label="Settings"
        />
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-1 pb-1.5 font-medium text-2xs text-sidebar-muted-foreground uppercase tracking-wider">{children}</div>;
}

type SidebarRowProps = {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  meta?: React.ReactNode;
};

function SidebarRow({ active, onClick, icon, label, meta }: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-sidebar-muted-foreground",
        "hover:bg-sidebar-row-hover data-active:bg-sidebar-row-selected data-active:font-medium data-active:shadow-xs/5 data-active:[&_svg]:text-sidebar-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta !== undefined && <span className="text-sidebar-muted-foreground text-xs tabular-nums">{meta}</span>}
    </button>
  );
}
