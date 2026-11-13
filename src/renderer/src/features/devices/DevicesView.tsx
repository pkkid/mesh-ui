import { Cable, RefreshCw, Search, TriangleAlert, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import type { Device, Network } from "@shared/types";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { TopBar } from "~/features/shell/TopBar";
import { cn } from "~/lib/utils";

type Filter = "all" | "online" | "offline";

type DevicesViewProps = {
  network: Network | null;
  refreshing: boolean;
  error?: string;
  onRefresh: () => void;
};

export function DevicesView({ network, refreshing, error, onRefresh }: DevicesViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const devices = network?.devices ?? [];
  const online = devices.filter((d) => d.connected).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter((d) => (filter === "all" ? true : filter === "online" ? d.connected : !d.connected))
      .filter((d) => !q || [d.name, d.ip, d.mac, d.manufacturer, d.via].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  }, [devices, query, filter]);

  return (
    <>
      <TopBar
        title={network?.name ?? "Devices"}
        subtitle={network && `${online} online · ${devices.length} known`}
        actions={
          <Button variant="ghost-muted" size="icon-sm" onClick={onRefresh} disabled={refreshing} title="Refresh">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
          </Button>
        }
      />

      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <Input
          type="search"
          placeholder="Search devices"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          icon={<Search />}
          className="max-w-72"
        />
        <div className="flex rounded-lg border bg-muted p-0.5">
          {(["all", "online", "offline"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              data-active={filter === f || undefined}
              className="h-6.5 cursor-pointer rounded-md px-2.5 text-muted-foreground text-xs capitalize transition-colors hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-xs/5"
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-destructive/24 bg-error-surface px-3 py-2 text-destructive-foreground text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-muted-foreground text-xs">
                <Th>Name</Th>
                <Th>IP address</Th>
                <Th>MAC</Th>
                <Th>Connection</Th>
                <Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <DeviceRow key={d.id} device={d} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              {devices.length === 0 ? "No devices on this network" : "No devices match"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>;
}

function DeviceRow({ device: d }: { device: Device }) {
  const ConnIcon = d.wireless ? Wifi : Cable;
  const conn = d.wireless ? `Wi-Fi${d.frequency ? ` ${d.frequency} GHz` : ""}` : "Wired";
  return (
    <tr className={cn("border-b last:border-b-0 hover:bg-accent/60", !d.connected && "text-muted-foreground")}>
      <td className="max-w-64 px-3 py-2">
        <div className="truncate font-medium" data-selectable>
          {d.name}
        </div>
        {d.manufacturer && d.manufacturer !== d.name && (
          <div className="truncate text-muted-foreground text-xs">{d.manufacturer}</div>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs tabular-nums" data-selectable>
        {d.ip ?? "-"}
      </td>
      <td className="px-3 py-2 font-mono text-muted-foreground text-xs" data-selectable>
        {d.mac ?? "-"}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs">
          <ConnIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {conn}
            {d.via && <span className="text-muted-foreground"> via {d.via}</span>}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <Badge variant={d.connected ? "success" : "secondary"} className={cn(!d.connected && "text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", d.connected ? "bg-success" : "bg-muted-foreground/50")} />
          {d.connected ? "Online" : "Offline"}
        </Badge>
      </td>
    </tr>
  );
}
