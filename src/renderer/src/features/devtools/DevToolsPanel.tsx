/**
 * The F12 dev tools panel (docs/architecture/devtools.md): eero requests,
 * docked across the bottom of the window. It records only while open and
 * not paused; closing it stops recording in main and drops every record.
 * Records arrive redacted from main: never the session token.
 */
import { Ban, ExternalLink, Pause, Play, Search, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { InspectRecord } from "../../../../core/eero/inspect";
import { formatBytes } from "../../../../core/format";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { StatusDot, type StatusTone } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { JsonTree } from "./JsonTree";
import { formatMs, matches, requestPath, setDevToolsOpen, tagFor, upsertRecord } from "./devtools";

const SIZES_KEY = "mesh-ui:devtools:v1";
const DEFAULT_SIZES = { height: 320, detail: 352 };
const MIN_HEIGHT = 160;
/** The detail pane's narrowest width, and the narrowest the request list may get beside it. */
const MIN_DETAIL = 240;
const MIN_LIST = 320;

type Sizes = { height: number; detail: number };

/** The panel's height and the detail pane's width, remembered per window (view state). */
function readSizes(): Sizes {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) ?? "{}") as Partial<Sizes>;
    const height = Number(saved.height);
    const detail = Number(saved.detail);
    return {
      height: Number.isFinite(height) && height >= MIN_HEIGHT ? height : DEFAULT_SIZES.height,
      detail: Number.isFinite(detail) && detail >= MIN_DETAIL ? detail : DEFAULT_SIZES.detail,
    };
  } catch {
    return DEFAULT_SIZES;
  }
}

function saveSizes(sizes: Sizes): void {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage unavailable: the sizes are not remembered.
  }
}

/** Follows the pointer from a drag handle until it is released, then calls `done`. */
function trackDrag(e: ReactPointerEvent<HTMLElement>, move: (dx: number, dy: number) => void, done: () => void): void {
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    done();
  };
  document.body.style.cursor = getComputedStyle(e.currentTarget).cursor;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function toneFor(r: InspectRecord): StatusTone {
  if (r.outcome === "pending") return "muted";
  if (r.status === null || r.status >= 500) return "destructive";
  if (r.status >= 400) return "warning";
  return "success";
}

type Tab = "headers" | "response" | "timing";

export function DevToolsPanel() {
  const [records, setRecords] = useState<InspectRecord[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("headers");
  const [sizes, setSizes] = useState(readSizes);
  const body = useRef<HTMLDivElement>(null);
  const mesh = window.mesh?.devtools;

  // Recording runs only while the panel is open and not paused.
  useEffect(() => {
    if (!mesh || paused) return;
    const off = mesh.onRecord((r) => setRecords((list) => upsertRecord(list, r)));
    void mesh.capture(true).then((res) => setAvailable(res.available));
    return () => {
      off();
      void mesh.capture(false);
    };
  }, [mesh, paused]);

  const shown = useMemo(() => records.filter((r) => matches(r, query, errorsOnly)), [records, query, errorsOnly]);
  const total = useMemo(() => records.reduce((sum, r) => sum + r.responseBytes, 0), [records]);
  const current = records.find((r) => r.id === selected) ?? null;

  // The list follows new requests while it is scrolled to the bottom; scroll up and it stays put.
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const onListScroll = () => {
    const el = list.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };
  useLayoutEffect(() => {
    const el = list.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const finishDrag = () => setSizes((now) => (saveSizes(now), now));
  // The top edge sets the panel's height; the detail pane's left edge sets its width.
  const resizeHeight = (e: ReactPointerEvent<HTMLElement>) => {
    const from = sizes.height;
    const max = Math.max(MIN_HEIGHT, window.innerHeight - 160);
    trackDrag(e, (_dx, dy) => setSizes((now) => ({ ...now, height: Math.min(max, Math.max(MIN_HEIGHT, from - dy)) })), finishDrag);
  };
  const resizeDetail = (e: ReactPointerEvent<HTMLElement>) => {
    const from = sizes.detail;
    const max = Math.max(MIN_DETAIL, (body.current?.clientWidth ?? window.innerWidth) - MIN_LIST);
    trackDrag(e, (dx) => setSizes((now) => ({ ...now, detail: Math.min(max, Math.max(MIN_DETAIL, from - dx)) })), finishDrag);
  };

  return (
    // A 2px top edge (1px everywhere else in the app) sets the panel apart as a developer view, not part of the app.
    <section aria-label="Dev tools: eero requests" style={{ height: sizes.height }} className="relative flex shrink-0 flex-col border-t-2 bg-card text-xs">
      <div role="separator" aria-orientation="horizontal" aria-label="Resize dev tools" onPointerDown={resizeHeight} className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize" />
      <div className="flex shrink-0 items-center gap-2 border-border/60 border-b px-3 py-1.5">
        <span className="flex items-center gap-2 whitespace-nowrap font-semibold">
          <StatusDot tone={paused || available === false ? "muted" : "destructive"} />
          eero requests
        </span>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter path, command or status"
          aria-label="Filter requests"
          icon={<Search />}
          className="ms-1 h-7 max-w-64 text-xs [&_input]:h-7"
        />
        {/* The label says what a click does: show only errors, or show every request again. */}
        <Button size="xs" variant="outline" onClick={() => setErrorsOnly((v) => !v)}>
          {errorsOnly ? "Show all" : "Show errors only"}
        </Button>
        {/* Pause and Clear as icons beside the filters, since they act on the same list. */}
        <Button
          size="icon-xs"
          variant="outline"
          onClick={() => setPaused((p) => !p)}
          disabled={available === false}
          aria-label={paused ? "Record requests" : "Pause recording"}
          title={paused ? "Record" : "Pause"}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <Button
          size="icon-xs"
          variant="outline"
          aria-label="Clear requests"
          title="Clear"
          onClick={() => {
            setRecords([]);
            setSelected(null);
          }}
        >
          <Ban />
        </Button>
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {shown.length === records.length ? `${records.length} ${records.length === 1 ? "request" : "requests"}` : `${shown.length} of ${records.length}`} · {formatBytes(total)}
        </span>
        <span className="flex-1" />
        <Button size="xs" variant="outline" onClick={() => mesh?.openElectron()} title="Electron's developer tools, docked to the right">
          DevTools
          <ExternalLink />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close dev tools (F12)" title="Close (F12)" onClick={() => setDevToolsOpen(false)}>
          <X />
        </Button>
      </div>

      <div ref={body} className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `minmax(0, 1fr) min(${sizes.detail}px, calc(100% - ${MIN_LIST}px))` }}>
        <div ref={list} onScroll={onListScroll} className="min-h-0 overflow-auto border-border/60 border-e">
          {available === false ? (
            <p className="p-4 text-muted-foreground">Demo mode makes no eero requests, so there is nothing to show.</p>
          ) : records.length === 0 ? (
            <p className="p-4 text-muted-foreground">{paused ? "Paused. Press Record to capture eero requests." : "Waiting for eero requests…"}</p>
          ) : (
            <table className="w-full table-fixed border-collapse tabular-nums">
              <colgroup>
                <col className="w-16" />
                <col />
                <col className="w-36" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground">
                  <th className="border-border/60 border-b px-2 py-1 text-start font-normal">Status</th>
                  <th className="border-border/60 border-b px-2 py-1 text-start font-normal">Request</th>
                  <th className="border-border/60 border-b px-2 py-1 text-start font-normal">Command</th>
                  <th className="border-border/60 border-b px-2 py-1 text-end font-normal">Size</th>
                  <th className="border-border/60 border-b px-2 py-1 text-end font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const tag = tagFor(r);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      aria-selected={r.id === selected}
                      className={cn("cursor-pointer border-border/50 border-b hover:bg-muted/50", r.id === selected && "bg-muted")}
                    >
                      <td className="whitespace-nowrap px-2 py-1">
                        <span className="flex items-center gap-1.5">
                          <StatusDot tone={toneFor(r)} />
                          {r.status ?? "-"}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-2xs text-muted-foreground">{r.method}</span>
                          <span className="truncate font-mono text-[11px]" title={requestPath(r)}>
                            {requestPath(r)}
                          </span>
                          {tag && <span className="shrink-0 rounded border px-1 text-2xs text-muted-foreground">{tag}</span>}
                        </span>
                      </td>
                      <td className="truncate whitespace-nowrap px-2 py-1 text-muted-foreground">{r.command ?? "-"}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-end">{r.status === null ? "-" : formatBytes(r.responseBytes)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-end">{formatMs(r.timing?.totalMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize request details"
            onPointerDown={resizeDetail}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize"
          />
          <Detail record={current} tab={tab} onTab={setTab} />
        </div>
      </div>
    </section>
  );
}

function Detail({ record: r, tab, onTab }: { record: InspectRecord | null; tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex shrink-0 gap-0.5 border-border/60 border-b px-2 py-1">
        {(["headers", "response", "timing"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={cn("cursor-pointer rounded-md px-2 py-0.5 capitalize text-muted-foreground hover:text-foreground", tab === t && "bg-muted text-foreground")}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!r ? (
          <p className="text-muted-foreground">Select a request to see its headers, response and timing.</p>
        ) : tab === "headers" ? (
          <div className="flex flex-col gap-3">
            <Pairs
              rows={[
                ["URL", r.url],
                ["Method", r.method],
                ["Status", r.status === null ? (r.outcome === "pending" ? "waiting" : "no response") : String(r.status)],
                ["Command", r.command ?? "-"],
                ...(r.eeroError ? ([["eero error", r.eeroError]] as Array<[string, string]>) : []),
                ...(r.error ? ([["Error", r.error]] as Array<[string, string]>) : []),
              ]}
            />
            <Group title="Request headers">
              <Pairs rows={r.requestHeaders} />
            </Group>
            {r.requestBody !== null && (
              <Group title="Request body">
                <JsonTree text={r.requestBody} />
              </Group>
            )}
            {r.responseHeaders.length > 0 && (
              <Group title="Response headers">
                <Pairs rows={r.responseHeaders} />
              </Group>
            )}
          </div>
        ) : tab === "response" ? (
          r.responseBody === null ? (
            <p className="text-muted-foreground">{r.outcome === "pending" ? "Waiting for eero…" : "No response."}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground tabular-nums">
                {formatBytes(r.responseBytes)}
                {r.truncated && " · cut at 256 KB"}
              </p>
              <JsonTree text={r.responseBody} />
            </div>
          )
        ) : (
          <Timing record={r} />
        )}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-2xs text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Pairs({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px]">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="contents">
          {/* Every label 140px wide; a longer one ends in an ellipsis with the full name in its tooltip. */}
          <dt className="truncate text-muted-foreground" title={k}>
            {k}
          </dt>
          <dd className={cn("m-0 break-all", v.includes("(hidden)") && "text-muted-foreground italic")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Timing({ record: r }: { record: InspectRecord }) {
  const t = r.timing;
  if (!t) return <p className="text-muted-foreground">Waiting for eero…</p>;
  const total = Math.max(1, t.totalMs);
  const parts: Array<[string, number, number]> = [
    ["Queued (rate limit)", 0, t.queuedMs],
    ["Waiting for eero", t.queuedMs, t.waitMs],
    ["Download", t.queuedMs + t.waitMs, t.downloadMs],
  ];
  return (
    <div className="flex flex-col gap-1.5 tabular-nums">
      {parts.map(([label, start, ms]) => (
        <div key={label} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-2">
          <span className="text-muted-foreground">{label}</span>
          <span className="relative h-1.5 rounded-full bg-muted">
            <span className="absolute inset-y-0 rounded-full bg-muted-foreground/60" style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.5, (ms / total) * 100)}%` }} />
          </span>
          <span className="text-end">{formatMs(ms)}</span>
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[8rem_1fr_4rem] gap-2 border-border/50 border-t pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span />
        <span className="text-end font-medium">{formatMs(t.totalMs)}</span>
      </div>
      <div className="mt-2 grid grid-cols-[8rem_1fr] gap-2">
        <span className="text-muted-foreground">Started</span>
        <span>{new Date(r.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
        <span className="text-muted-foreground">Outcome</span>
        <span>{r.outcome}</span>
      </div>
    </div>
  );
}
