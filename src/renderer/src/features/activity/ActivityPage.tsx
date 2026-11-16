/**
 * Activity (docs/ux/pages/activity.md, mockup 10): a live view. eero sends
 * only its last ~15 minutes of events, so the page shows those plus every
 * event read while the app is open: the kept events by type (compact hero,
 * chip legend that filters, a stacked chart sized to the span) beside the
 * most active devices, eeros and profiles (pick one to filter), the filter
 * bar (no range), and the event stream with grouped rows, day bars and paging. Export CSV saves the
 * filtered events through the native save dialog.
 *
 * Every figure, filter and group comes from `events.summary` and
 * `events.list`; this page keeps only view state (types shown, filters,
 * Grouped / Raw, pages loaded). The stream's "Unread"
 * marker is eero's one network-wide `has_unread` flag from `notifications.list`
 * (the bell's poll): eero keeps no read flag per event, so rows carry no dots.
 */
import { Check, FileDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PageProps } from "~/app/routes";
import { execute, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { useSlashFocus } from "~/components/ui/filter-bar";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Status } from "~/components/ui/status";
import { MarkAllReadButton } from "~/features/notifications/NotificationList";
import { useNotificationPage } from "~/features/notifications/useDesktopAlerts";
import { TopBarActions } from "~/features/shell/TopBar";
import { datedName, saveTextFile } from "~/lib/saveFile";
import { networkClock } from "../../../../core/format";
import type { Device, DeviceList, Eero, EventCategory, EventPage, EventSummary, EventTopEntity, Network, NetworkEvent, ProfileList } from "../../../../core/model";

import { ActivityChart, CATEGORY_ORDER, stepLabel } from "./ActivityChart";
import { ActivityHero, sinceLine } from "./ActivityHero";
import { EMPTY_FILTERS, type EventFilterState, EventFilters } from "./EventFilters";
import { EventStream, StreamSettingsButton } from "./EventStream";
import { MostActive } from "./MostActive";

type Mode = "grouped" | "raw";

/** Whether the window is visible: the stream polls only then (useQuery pauses), and the Live dot says so. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

const unset = <T,>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function ActivityPage(_props: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const clock = networkClock(network.data?.timezone);
  const visible = useVisible();
  const notifications = useNotificationPage();
  const unread = notifications.data?.unread === true;

  const [mode, setMode] = useState<Mode>("grouped");
  const [hidden, setHidden] = useState<ReadonlySet<EventCategory>>(new Set());
  const [filters, setFilters] = useState<EventFilterState>(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  // Text filter is a param: debounce so typing does not send a request per key.
  useEffect(() => {
    if (searchText === filters.search) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchText })), 250);
    return () => clearTimeout(t);
  }, [searchText, filters.search]);

  const entity = { device: unset(filters.device), eero: unset(filters.eero), profile: unset(filters.profile) };
  // Hero, chart, Most active and day bars: the kept events, every type (the legend hides types in view), entity filters applied.
  const summary = useQuery<EventSummary>("events.summary", { range: "kept", ...entity }, { poll: true });
  const selectedEntity = filters.device ? `device:${filters.device}` : filters.eero ? `eero:${filters.eero}` : filters.profile ? `profile:${filters.profile}` : null;
  const pickEntity = (t: EventTopEntity) =>
    setFilters((f) => ({ ...f, device: null, eero: null, profile: null, ...(selectedEntity === `${t.kind}:${t.id}` ? {} : { [t.kind]: t.id }) }));
  const since = sinceLine(summary.data, clock);

  const shownTypes = CATEGORY_ORDER.filter((c) => !hidden.has(c));
  const streamParams = {
    ...entity,
    search: filters.search.trim() || undefined,
    type: hidden.size > 0 ? shownTypes : undefined,
  };
  const listParams = { ...streamParams, grouped: mode === "grouped" };
  const first = useQuery<EventPage>("events.list", listParams, { poll: true });

  // Older pages, appended below the first; reset whenever the filters change.
  const paramsKey = JSON.stringify(listParams);
  const [older, setOlder] = useState<{ key: string; pages: EventPage[]; loading: boolean; error: string | null }>({ key: paramsKey, pages: [], loading: false, error: null });
  const olderPages = older.key === paramsKey ? older.pages : [];
  const lastPage = olderPages[olderPages.length - 1] ?? first.data;
  const loadOlder = async () => {
    const cursor = lastPage?.nextCursor;
    if (!cursor) return;
    setOlder({ key: paramsKey, pages: olderPages, loading: true, error: null });
    const r = await execute<EventPage>("events.list", { ...listParams, cursor });
    setOlder((o) =>
      o.key !== paramsKey ? o : r.ok ? { key: paramsKey, pages: [...olderPages, r.result], loading: false, error: null } : { ...o, loading: false, error: r.error.message },
    );
  };

  const rows = useMemo(() => {
    if (!first.data) return undefined;
    const seen = new Set<string>();
    const out: NetworkEvent[] = [];
    for (const p of [first.data, ...olderPages]) for (const e of p.events) if (!seen.has(e.id)) (seen.add(e.id), out.push(e));
    return out;
  }, [first.data, olderPages]);

  // Filter options, read when the page opens.
  const devices = useQuery<DeviceList>("device.list", {});
  const eeros = useQuery<Eero[]>("eero.list");
  const profiles = useQuery<ProfileList>("profile.list");
  const deviceOptions = useMemo(
    () => (devices.data?.devices ?? []).map((d: Device) => ({ value: d.id, label: d.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [devices.data],
  );
  const eeroOptions = useMemo(() => (eeros.data ?? []).map((e) => ({ value: e.id, label: e.location ?? e.id })), [eeros.data]);
  const profileOptions = useMemo(() => (profiles.data?.profiles ?? []).map((p) => ({ value: p.id, label: p.name })), [profiles.data]);

  const filtered = hidden.size > 0 || filters.search !== "" || searchText !== "" || filters.device !== null || filters.eero !== null || filters.profile !== null;
  const toggle = (c: EventCategory) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(c)) next.delete(c);
      else if (next.size < CATEGORY_ORDER.length - 1) next.add(c);
      return next;
    });

  const streamError = first.error ? (
    <SectionError what="events" error={first.error} onRetry={() => void first.refetch()} />
  ) : older.error && older.key === paramsKey ? (
    <SectionError what="older events" error={{ code: "eero_error", message: older.error }} onRetry={() => void loadOlder()} />
  ) : null;

  const footer =
    // Also when a narrow filter found nothing in the pages read so far: older pages may still match.
    rows && (rows.length > 0 || lastPage?.nextCursor) ? (
      <div className="flex justify-center border-t px-4 py-3">
        {lastPage?.nextCursor ? (
          <Button size="xs" variant="outline" disabled={older.loading && older.key === paramsKey} onClick={() => void loadOlder()}>
            {older.loading && older.key === paramsKey ? "Loading older events..." : "Load older events"}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">That's every event so far. eero shares only its last 15 minutes; newer ones are added while Mesh UI is open.</span>
        )}
      </div>
    ) : null;

  return (
    <>
      <TopBarActions>
        <ExportCsvButton params={streamParams} network={network.data?.name ?? null} />
      </TopBarActions>

      <Section
        title="Events by type"
        subtitle={[since, summary.data && `per ${stepLabel(summary.data.step)}`, "pick a type or a device to filter the stream"].filter(Boolean).join(" · ")}
      >
        {summary.error && !summary.data ? (
          <SectionError what="the event summary" error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded className="flex flex-col gap-3">
              <ActivityHero summary={summary.data} hidden={hidden} onToggle={toggle} loading={summary.fading} />
              <ActivityChart summary={summary.data} hidden={hidden} timeZone={network.data?.timezone ?? "UTC"} loading={summary.fading || !summary.data} fill />
            </Card>
            <Card padded>
              <MostActive
                summary={summary.data}
                timeZone={network.data?.timezone ?? "UTC"}
                loading={summary.fading}
                selected={selectedEntity}
                onPick={pickEntity}
              />
            </Card>
          </div>
        )}
      </Section>

      <Section
        title={
          <span className="inline-flex items-center gap-3">
            Event stream
            {unread && (
              <Status tone="info" title="eero says some notifications are unread">
                Unread notifications
              </Status>
            )}
          </span>
        }
        subtitle="Newest first · polled every 60 s"
      >
        <EventFilters
          value={filters}
          searchText={searchText}
          onSearchText={setSearchText}
          searchRef={searchRef}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          devices={deviceOptions}
          eeros={eeroOptions}
          profiles={profileOptions}
          hiddenTypes={hidden.size}
          onShowAllTypes={() => setHidden(new Set())}
          end={
            <>
              <Status tone={visible ? "success" : "muted"}>{visible ? "Live" : "Paused"}</Status>
              <Segmented
                aria-label="Stream grouping"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "grouped", label: "Grouped" },
                  { value: "raw", label: "Raw" },
                ]}
              />
              <MarkAllReadButton networkId={notifications.networkId} page={notifications.data} />
              <StreamSettingsButton />
            </>
          }
        />
        <EventStream
          rows={rows}
          hours={summary.data}
          clock={clock}
          loading={first.loading}
          fading={first.fading}
          emptyText={filtered ? "No events match these filters." : "No events yet. New ones show up here as they happen."}
          error={streamError}
          footer={footer}
          networkName={network.data?.name ?? null}
        />
      </Section>
    </>
  );
}

function fileStem(network: string | null): string {
  const slug = (network ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `events-${slug}` : "events";
}

/** Export CSV: every event matching the current filters (up to 1,000), built in core, saved where the user picks. */
function ExportCsvButton({ params, network }: { params: Record<string, unknown>; network: string | null }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "saved"; name: string } | { kind: "failed"; message: string }>({ kind: "idle" });
  const run = async () => {
    setState({ kind: "busy" });
    const r = await execute<string>("events.list", { ...params, limit: 1000, format: "csv" });
    if (!r.ok) return setState({ kind: "failed", message: r.error.message });
    const saved = await saveTextFile(datedName(fileStem(network), "csv"), r.result);
    if (saved.status === "saved") setState({ kind: "saved", name: saved.name });
    else if (saved.status === "failed") setState({ kind: "failed", message: saved.message });
    else setState({ kind: "idle" });
  };
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={state.kind === "busy"}
      title={state.kind === "saved" ? `Saved ${state.name}` : state.kind === "failed" ? state.message : undefined}
      onClick={() => void run()}
    >
      {state.kind === "saved" ? <Check /> : <FileDown />}
      {state.kind === "saved" ? "CSV saved" : state.kind === "failed" ? "Couldn't save" : "Export CSV"}
    </Button>
  );
}
