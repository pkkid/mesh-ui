/**
 * While Live is on, on every page (#319): asks eero for live rates
 * (`useLiveRates`, a burst a minute and the reads in its window) and records
 * each `device.list` read into the live readings (`liveReadings.ts`), so the
 * Devices charts and device detail keep their history wherever you are.
 * Mounted by the shell; renders nothing. Readings are cleared when Live goes
 * off.
 */
import { useEffect } from "react";

import { useQuery } from "~/app/useCommand";
import { useLiveMode } from "~/app/useLiveMode";
import { useLiveRates } from "~/app/useLiveRates";
import type { DeviceList, Network } from "../../../core/model";
import { clearReadings, recordReadings } from "./liveReadings";

export function LiveCollector() {
  const [live] = useLiveMode();
  useEffect(() => {
    if (!live) clearReadings();
  }, [live]);
  return live ? <Collect /> : null;
}

function Collect() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const netId = network.data?.id ?? "";
  useLiveRates(netId !== "", netId);
  // The whole network, the same cache entry the Devices page reads.
  const list = useQuery<DeviceList>("device.list", {}, { poll: true, enabled: netId !== "" });
  const data = list.data;
  useEffect(() => {
    if (!data || !netId) return;
    recordReadings([[netId, data.summary.rates], ...data.devices.map((d) => [`device:${d.id}`, d.rates] as const)]);
  }, [data, netId]);
  return null;
}
