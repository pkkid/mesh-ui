/**
 * Device detail (docs/ux/pages/device-detail.md, mockup 06): hero with the
 * device writes and the live Now box, data usage, device information, IP
 * addresses and port forwards. Block asks first with an inline confirm at
 * the top of the right column. Reservations and forwards stay disabled
 * until their commands land (M5).
 *
 * Prev and Next (also `[` and `]`) follow the Devices table's order, which
 * is view state the table remembers; opened without it (a restart, a deep
 * link) they follow `device.list`'s default order, A to Z.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { performWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { InlineConfirm } from "~/components/ui/confirm";
import { SectionError } from "~/components/ui/page";
import { TopBarActions, TopBarTitle } from "~/features/shell/TopBar";
import { blockRequest } from "~/features/devices/BulkBar";
import { devicesOrder } from "~/features/devices/DeviceTable";
import type { Device, DeviceList, Network } from "../../../../core/model";

import { DeviceAddresses } from "./DeviceAddresses";
import { DeviceForwards } from "./DeviceForwards";
import { DeviceHero } from "./DeviceHero";
import { DeviceInfo } from "./DeviceInfo";
import { DeviceUsage } from "./DeviceUsage";

/** What the page is showing, shared by its sections. */
export type DeviceView = {
  device: Device | undefined;
  network: Network | undefined;
  /** Bridge or IP passthrough: no profiles, pausing, blocking or routing. */
  bridged: boolean;
  guest: boolean;
};

export function DevicePage({ params }: PageProps) {
  const id = params.deviceId ?? "";
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const device = useQuery<Device>("device.get", { device: id }, { poll: true, enabled: id !== "" });
  const all = useQuery<DeviceList>("device.list", {}, { poll: true });
  const [blocking, setBlocking] = useState<"ask" | "running" | null>(null);
  // Another device (Prev, Next) closes the confirm.
  useEffect(() => setBlocking(null), [id]);

  const d = device.data;
  const n = network.data;
  // A device eero no longer knows: the ref matches nothing, or eero says 404.
  const gone = !d && !!device.error && (device.error.code === "bad_params" || device.error.detail?.status === 404);
  const view: DeviceView = {
    device: d,
    network: n,
    bridged: n?.connectionMode === "bridged" || n?.connectionMode === "ipPassthrough",
    guest: d?.ssid === "guest",
  };

  // Prev and Next: the Devices table's order when it has one with this device, else A to Z.
  const order = useMemo(() => {
    const shown = devicesOrder();
    if (shown.includes(id)) return shown;
    return (all.data?.devices ?? []).map((x) => x.id);
  }, [id, all.data]);
  const at = order.indexOf(id);
  const prev = at > 0 ? order[at - 1] : undefined;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "[" && e.key !== "]")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      const to = e.key === "[" ? prev : next;
      if (!to) return;
      e.preventDefault();
      navigate(pathFor("device", { deviceId: to }), { replace: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  const step = (to: string | undefined, label: string, kbd: string, children: ReactNode) => (
    <Button
      variant="ghost"
      size="xs"
      disabled={!to}
      title={`${label} (${kbd})`}
      aria-keyshortcuts={kbd}
      onClick={() => to && navigate(pathFor("device", { deviceId: to }), { replace: true })}
    >
      {children}
    </Button>
  );

  return (
    <>
      {d && <TopBarTitle>{d.name}</TopBarTitle>}
      <TopBarActions>
        {step(prev, "Previous device", "[", (
          <>
            <ChevronLeft />
            Prev
          </>
        ))}
        {step(next, "Next device", "]", (
          <>
            Next
            <ChevronRight />
          </>
        ))}
      </TopBarActions>

      {gone ? (
        <Card>
          <Empty className="flex flex-col items-center gap-3">
            <span>This device is no longer on {n?.name ?? "this network"}.</span>
            <Button size="xs" variant="outline" render={<Link to={pathFor("devices")} />}>
              Back to Devices
            </Button>
          </Empty>
        </Card>
      ) : device.error && !d ? (
        <SectionError what="this device" error={device.error} onRetry={() => void device.refetch()} />
      ) : (
        <>
          <DeviceHero view={view} fallback={(all.data?.devices ?? []).find((x) => x.id === id)} onBlock={() => setBlocking("ask")} />
          {view.bridged && (
            <Card padded className="text-muted-foreground text-xs">
              {n?.name ?? "This network"} is in bridge mode. Pausing, profiles, blocking, reservations and port forwards
              need eero to run the network (NAT), so they are hidden here.
            </Card>
          )}
          <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className="flex min-w-0 flex-col gap-7">
              <DeviceUsage view={view} id={id} />
              <DeviceInfo view={view} />
            </div>
            <div className="flex min-w-0 flex-col gap-7">
              {blocking && d && !d.blocked && (
                <InlineConfirm
                  title={`Block ${d.name}?`}
                  confirmLabel="Block device"
                  running={blocking === "running"}
                  onCancel={() => setBlocking(null)}
                  onConfirm={async () => {
                    setBlocking("running");
                    // The confirm is this note, so the write does not ask again.
                    await performWrite(blockRequest([d], true, { networkName: n?.name, askFirst: false }));
                    setBlocking(null);
                  }}
                >
                  It will be disconnected from every eero and can't rejoin {n?.name ?? "this network"} until you unblock it from
                  Devices &gt; Blocked.
                </InlineConfirm>
              )}
              <DeviceAddresses view={view} />
              {!view.bridged && !view.guest && <DeviceForwards view={view} id={id} />}
            </div>
          </div>
        </>
      )}
    </>
  );
}
