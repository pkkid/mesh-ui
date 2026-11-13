/**
 * Devices (docs/ux/pages/devices.md, mockup 05), read-only in M1: summary
 * strip, toolbar with the Filters popover, and the grouped table with live rates.
 *
 * Filters, search and sort are `device.list` params, applied in core; this
 * page only keeps what the user picked (per network, for the session) and
 * groups the rows it gets back. Live rates come from `device.rates.refresh`
 * once a minute while the page is visible; the engine enforces the limit.
 */
import { Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { useLiveRates } from "~/app/useLiveRates";
import { Button } from "~/components/ui/button";
import { entityColors } from "~/lib/chartColors";
import { TopBarActions, TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative } from "../../../../core/format";
import type { DeviceList, Eero, Network, ProfileList, UsageBreakdown } from "../../../../core/model";

import {
  type ColumnKey,
  DeviceFilters,
  type DeviceFilterState,
  EMPTY_FILTERS,
  type GroupBy,
  type SortKey,
  UNASSIGNED,
} from "./DeviceFilters";
import { DeviceSummary } from "./DeviceSummary";
import { BulkBar, DeviceTable, type ProfileInfo } from "./DeviceTable";

type ViewState = { filters: DeviceFilterState; sort: SortKey; groupBy: GroupBy };

const DEFAULT_VIEW: ViewState = { filters: EMPTY_FILTERS, sort: "name", groupBy: "category" };

/** Filter state per network, kept while the app runs (docs: "filter state kept per network"). */
const views = new Map<string, ViewState>();

const COLUMNS_KEY = "mesh-ui:devices:columns:v1";

function readHidden(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? (list.filter((c) => typeof c === "string") as ColumnKey[]) : []);
  } catch {
    return new Set();
  }
}

function saveHidden(hidden: ReadonlySet<ColumnKey>) {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify([...hidden]));
  } catch {
    // Storage unavailable: columns reset next launch.
  }
}

/** The `device.list` params for what is picked. Unset filters are left out. */
export function listParams(f: DeviceFilterState, sort: SortKey): Record<string, unknown> {
  return {
    search: f.search.trim() || undefined,
    ssid: f.ssid === "all" ? undefined : f.ssid,
    status: f.status === "all" ? undefined : f.status,
    band: f.band ?? undefined,
    eero: f.eero ?? undefined,
    profile: f.profile === null ? undefined : f.profile === UNASSIGNED ? null : f.profile,
    type: f.type ?? undefined,
    manufacturer: f.manufacturer ?? undefined,
    firstSeenSince: f.newSince ?? undefined,
    sort: sort === "name" ? undefined : sort,
  };
}

export function DevicesPage() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const netId = network.data?.id ?? "";

  const [view, setView] = useState<ViewState>(() => views.get(netId) ?? DEFAULT_VIEW);
  const [searchText, setSearchText] = useState(view.filters.search);
  const [hidden, setHidden] = useState<Set<ColumnKey>>(readHidden);
  const searchRef = useRef<HTMLInputElement>(null);

  // Switching network brings back that network's filters.
  const shownNet = useRef(netId);
  useEffect(() => {
    if (shownNet.current === netId) return;
    shownNet.current = netId;
    const next = views.get(netId) ?? DEFAULT_VIEW;
    setView(next);
    setSearchText(next.filters.search);
  }, [netId]);
  useEffect(() => {
    if (netId) views.set(netId, view);
  }, [netId, view]);

  const patchFilters = (patch: Partial<DeviceFilterState>) => setView((v) => ({ ...v, filters: { ...v.filters, ...patch } }));

  // Search runs as a param, debounced so typing does not send a request per key.
  useEffect(() => {
    if (searchText === view.filters.search) return;
    const t = setTimeout(() => patchFilters({ search: searchText }), 200);
    return () => clearTimeout(t);
  }, [searchText, view.filters.search]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const params = listParams(view.filters, view.sort);
  const list = useQuery<DeviceList>("device.list", params, { poll: true });
  // A new filter is a new query: keep the last rows on screen (faded) until it answers.
  const lastList = useRef<DeviceList | undefined>(undefined);
  if (list.data) lastList.current = list.data;
  const shown = list.data ?? lastList.current;
  // The whole network (same entry as `list` while nothing is filtered): new-this-week rows, manufacturer options.
  const all = useQuery<DeviceList>("device.list", {}, { poll: true });
  const guests = useQuery<DeviceList>("device.list", { ssid: "guest" }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const usage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const ratesPending = useLiveRates(netId !== "", netId);

  const eeroName = useMemo(() => new Map((eeros.data ?? []).map((e) => [e.id, e.location])), [eeros.data]);
  const profileInfo = useMemo(() => {
    const list = profiles.data?.profiles ?? [];
    const colors = entityColors(list.map((p) => p.id));
    return new Map<string, ProfileInfo>(list.map((p) => [p.id, { name: p.name, color: colors[p.id] ?? "" }]));
  }, [profiles.data]);
  const usageById = useMemo(
    () => (usage.data ? new Map(usage.data.rows.flatMap((r) => (r.id ? [[r.id, r.down + r.up] as const] : []))) : undefined),
    [usage.data],
  );
  const manufacturers = useMemo(() => {
    const names = new Set((all.data?.devices ?? []).flatMap((d) => (d.manufacturer ? [d.manufacturer] : [])));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [all.data]);

  const summary = shown?.summary ?? all.data?.summary;
  const newIds = useMemo(() => new Set(summary?.newThisWeek ?? []), [summary]);
  const filtersActive = JSON.stringify(view.filters) !== JSON.stringify(EMPTY_FILTERS);
  const resetFilters = () => {
    setSearchText("");
    patchFilters(EMPTY_FILTERS);
  };

  return (
    <>
      <TopBarSubtitle>
        <Updated at={list.fetchedAt} />
      </TopBarSubtitle>
      <TopBarActions>
        <Button variant="outline" size="xs" disabled title="Sharing Wi-Fi comes with the Wi-Fi page">
          <Share2 />
          Share Wi-Fi
        </Button>
      </TopBarActions>

      <DeviceSummary
        summary={summary}
        devices={all.data?.devices}
        eeroName={eeroName}
        ratesPending={ratesPending}
        fading={all.fading && !all.data}
      />

      <section className="flex flex-col gap-2.5" aria-label="Devices">
        <DeviceFilters
          filters={view.filters}
          searchText={searchText}
          onSearchText={setSearchText}
          onChange={patchFilters}
          summary={summary}
          guestCount={guests.data?.devices.length}
          eeros={(eeros.data ?? []).map((e) => ({ value: e.id, label: e.location }))}
          profiles={(profiles.data?.profiles ?? []).map((p) => ({ value: p.id, label: p.name, count: p.deviceIds.length }))}
          manufacturers={manufacturers}
          groupBy={view.groupBy}
          onGroupBy={(groupBy) => setView((v) => ({ ...v, groupBy }))}
          sort={view.sort}
          onSort={(sort) => setView((v) => ({ ...v, sort }))}
          hidden={hidden}
          onToggleColumn={(c) =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(c)) next.delete(c);
              else next.add(c);
              saveHidden(next);
              return next;
            })
          }
          searchRef={searchRef}
        />
        <BulkBar />
        <DeviceTable
          devices={list.error && !list.data ? undefined : shown?.devices}
          groupBy={view.groupBy}
          hidden={hidden}
          eeroName={eeroName}
          profiles={profileInfo}
          usage={usageById}
          newIds={newIds}
          ratesPending={ratesPending}
          fading={list.fading || (!list.data && !!shown)}
          error={list.error?.message ?? null}
          onRetry={() => void list.refetch()}
          filtersActive={filtersActive}
          onResetFilters={resetFilters}
          networkName={network.data?.name ?? null}
          total={summary?.total}
        />
      </section>
    </>
  );
}

/** "Updated just now", "Updated 2 min ago" in the topbar. */
function Updated({ at }: { at: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  if (at === null) return null;
  return <>Updated {formatRelative(new Date(at).toISOString(), Date.now())}</>;
}
