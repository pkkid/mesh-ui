/**
 * Activity (docs/ux/pages/activity.md, mockup 10): a live view. eero sends
 * only its last ~15 minutes of events, so the page shows those plus every
 * event read while the app is open: the flat hero (kept events, Live, the
 * busiest type, the most active name, page actions, and Events over time on
 * the right), then the event stream: filter bar (no range), grouped rows, day
 * bars and paging. Export CSV saves the filtered events through the native
 * save dialog.
 *
 * Every figure, filter and group comes from `events.summary` and
 * `events.list`; this page keeps only view state (filters, Show, pages
 * loaded). The hero's "Unread notifications" status is eero's one
 * network-wide `has_unread` flag from `notifications.list` (the bell's poll):
 * eero keeps no read flag per event, so rows carry no dots.
 */
import { Check, FileDown, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PageProps } from "~/app/routes";
import { execute, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Section } from "~/components/ui/card";
import { FilterDropdown, useSlashFocus } from "~/components/ui/filter-bar";
import { Footnote, SectionError } from "~/components/ui/page";
import { MarkAllReadButton } from "~/features/notifications/NotificationList";
import { useNotificationPage } from "~/features/notifications/useDesktopAlerts";
import { datedName, saveTextFile } from "~/lib/saveFile";
import { formatCount, networkClock } from "../../../../core/format";
import type { Device, DeviceList, Eero, EventPage, EventSummary, Network, NetworkEvent, ProfileList } from "../../../../core/model";

import { ActivityHero } from "./ActivityHero";
import { EMPTY_FILTERS, type EventFilterState, EventFilters } from "./EventFilters";
import { EventStream, NotificationSettingsButton } from "./EventStream";

type Mode = "grouped" | "raw";

/** The stream's Show choice, remembered across launches (view state, shared by every network). */
const MODE_KEY = "mesh-ui:activity:mode:v1";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "raw" ? "raw" : "grouped";
  } catch {
    return "grouped";
  }
}

function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage unavailable: the choice resets next launch.
  }
}

const MODE_OPTIONS = [
  { value: "grouped", label: "Group repeats" },
  { value: "raw", label: "Every event" },
];

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

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

  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    saveMode(m);
  };
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
  // Hero, Events over time and the type counts: every kept event, whatever the filters.
  const all = useQuery<EventSummary>("events.summary", { range: "kept" }, { poll: true });
  // Day bars: the kept events with the Device, eero and Profile filters (with none set, the same query as `all`).
  const summary = useQuery<EventSummary>("events.summary", { range: "kept", ...entity }, { poll: true });

  const streamParams = {
    ...entity,
    search: filters.search.trim() || undefined,
    type: filters.types.length > 0 ? filters.types : undefined,
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

  const filtered = filters.types.length > 0 || filters.search !== "" || searchText !== "" || filters.device !== null || filters.eero !== null || filters.profile !== null;

  const streamError = first.error ? (
    <SectionError what="events" error={first.error} onRetry={() => void first.refetch()} />
  ) : older.error && older.key === paramsKey ? (
    <SectionError what="older events" error={{ code: "eero_error", message: older.error }} onRetry={() => void loadOlder()} />
  ) : null;

  // Also when a narrow filter found nothing in the pages read so far: older pages may still match.
  const footer = rows && lastPage?.nextCursor ? (
    <div className="flex justify-center border-t px-4 py-3">
      <Button size="xs" variant="outline" disabled={older.loading && older.key === paramsKey} onClick={() => void loadOlder()}>
        {older.loading && older.key === paramsKey ? "Loading older events\u2026" : "Load older events"}
      </Button>
    </div>
  ) : null;
  const note =
    rows && rows.length > 0 && !lastPage?.nextCursor ? (
      <Footnote>eero shares only its last 15 minutes; newer events are added while Mesh UI is open.</Footnote>
    ) : null;

  // "50 events loaded, newest first, filtered": what the stream holds now, then what narrows it.
  const shownCount = rows?.reduce((n, e) => n + 1 + (e.grouped?.length ?? 0), 0);
  const streamLine =
    shownCount === undefined
      ? "-"
      : [
          `${plural(shownCount, "event")}${lastPage?.nextCursor ? " loaded" : ""}`,
          "newest first",
          (filters.types.length > 0 || filters.device || filters.eero || filters.profile || filters.search) && "filtered",
        ]
          .filter(Boolean)
          .join(", ");

  return (
    <>
      <ActivityHero
        summary={all.data}
        clock={clock}
        live={visible}
        unread={unread}
        fading={all.fading && !all.data}
        actions={
          <>
            <ExportCsvButton params={streamParams} network={network.data?.name ?? null} />
            <MarkAllReadButton networkId={notifications.networkId} page={notifications.data} />
            <NotificationSettingsButton />
          </>
        }
      />

      <Section title="Event stream" description={streamLine} className="gap-[15px]">
        <EventFilters
          value={filters}
          searchText={searchText}
          onSearchText={setSearchText}
          searchRef={searchRef}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          devices={deviceOptions}
          eeros={eeroOptions}
          profiles={profileOptions}
          typeCounts={all.data?.counts}
          end={<FilterDropdown label="Show" icon={Layers} value={mode} options={MODE_OPTIONS} onChange={(m) => m && setMode(m as Mode)} />}
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
          note={note}
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
