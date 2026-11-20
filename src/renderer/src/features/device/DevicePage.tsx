/**
 * Device detail (docs/ux/pages/device-detail.md, mockup 06): hero with the
 * device writes and Live throughput, data usage, device information, IP
 * addresses, port forwards and Device settings. Block asks first in the
 * confirm dialog. The topbar holds only the Live switch.
 *
 * `[` and `]` step to the previous and next device in the Devices table's
 * order, which is view state the table remembers; opened without it (a
 * restart, a deep link) they follow `device.list` in the Devices table's
 * remembered sort (features/devices/deviceSort.ts), with no filters.
 */
import { useEffect, useMemo } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { useLivePage } from "~/app/useLiveMode";
import { LiveToggle } from "~/components/mesh/LiveToggle";
import { performWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { TopBarActions, TopBarTitle } from "~/features/shell/TopBar";
import { blockRequest } from "~/features/devices/BulkBar";
import { devicesOrder } from "~/features/devices/DeviceTable";
import { readSort } from "~/features/devices/deviceSort";
import { SORT_DEFAULT_ORDER } from "../../../../core/commands/device";
import type { Device, DeviceList, Network } from "../../../../core/model";

import { DeviceHero } from "./DeviceHero";
import { DeviceInfo } from "./DeviceInfo";
import { DeviceNetwork } from "./DeviceNetwork";
import { DeviceSettings } from "./DeviceSettings";
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
  // Read once per page: the sort the Devices table would open with, defaults left out as Devices sends them.
  const listParams = useMemo(() => {
    const { sort, order } = readSort();
    return { ...(sort === "name" ? {} : { sort }), ...(order === SORT_DEFAULT_ORDER[sort] ? {} : { order }) };
  }, []);
  const all = useQuery<DeviceList>("device.list", listParams, { poll: true });

  const d = device.data;
  const listed = (all.data?.devices ?? []).find((x) => x.id === id);
  const n = network.data;
  // A device eero no longer knows: the ref matches nothing, or eero says 404.
  const gone = !d && !!device.error && (device.error.code === "bad_params" || device.error.detail?.status === 404);
  const view: DeviceView = {
    device: d,
    network: n,
    bridged: n?.connectionMode === "bridged" || n?.connectionMode === "ipPassthrough",
    guest: d?.ssid === "guest",
  };

  // `[` and `]` step to the previous and next device: the Devices table's order when it has one with this device, else its remembered sort.
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

  useLivePage();

  return (
    <>
      {/* Same name source as the hero: device.get, or the list's copy while it loads, so the crumb never lags the page. */}
      {(d ?? listed) && <TopBarTitle>{(d ?? listed)?.name}</TopBarTitle>}
      <TopBarActions>
        <LiveToggle size="tool" />
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
          <DeviceHero view={view} fallback={(all.data?.devices ?? []).find((x) => x.id === id)} onBlock={() => d && void performWrite(blockRequest([d], true, { networkName: n?.name }))} />
          {view.bridged && (
            <Card padded className="text-muted-foreground text-xs">
              {n?.name ?? "This network"} is in bridge mode. Pausing, profiles, blocking, reservations and port forwards
              need eero to run the network (NAT), so they are hidden here.
            </Card>
          )}
          {/* 56px between sections, the same as from the hero's rule to the first (design-system.md, Shape and spacing). */}
          <div className="flex flex-col gap-14">
            {/* Addresses and ports on the left (narrow), Data usage on the right; Device information spans both below. */}
            <div className="grid items-start gap-x-7 gap-y-14 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <DeviceNetwork view={view} id={id} />
              </div>
              <div className="min-w-0">
                <DeviceUsage view={view} id={id} />
              </div>
            </div>
            <DeviceInfo view={view} />
            <DeviceSettings view={view} />
          </div>
        </>
      )}
    </>
  );
}
