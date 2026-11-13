/**
 * The command palette (docs/ux/pages/command-palette.md, mockup 19): one
 * search over every registry command, page, device and profile, with a
 * preview that shows the same call as a CLI line and an MCP tool call.
 *
 * Opened by the titlebar search or Ctrl K / Cmd K (`openPalette`). It is a
 * surface like the CLI: commands come from `window.mesh.commands()` and run
 * through `window.mesh.execute`; nothing here knows what a command does.
 * Pages, devices and profiles navigate. Only query commands run for now;
 * the rest are listed dimmed with "Coming soon".
 */
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { navigate, pathFor } from "~/app/router";
import { ROUTES } from "~/app/routes";
import { execute, useCommands, useQuery } from "~/app/useCommand";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import type { AuthStatus, DeviceList, Eero, Permissions, ProfileList } from "../../../../core/model";
import { EffectTag, KIND_ICON, KIND_LABEL, Keys, PaletteResults, useCommandIcons } from "./PaletteResults";
import type { EntityOptions } from "./ParamsForm";
import { PalettePreview, type RunState } from "./PalettePreview";
import {
  chosenParams,
  cliLine,
  commandItems,
  defaultParams,
  deviceItems,
  type Item,
  KINDS,
  pageItems,
  paramFields,
  profileItems,
  type Scope,
  search,
  missingRequired,
  validateParams,
} from "./search";

// ---------------------------------------------------------------------------
// Open state, shared with the titlebar button

let isOpen = false;
const listeners = new Set<() => void>();
const setOpen = (open: boolean) => {
  isOpen = open;
  listeners.forEach((l) => l());
};

/** Opens the palette; a query replaces the last one (`openPalette(">eero.")`). */
export function openPalette(query?: string): void {
  if (query !== undefined) memory = { ...memory, query, selected: null };
  setOpen(true);
}

/** What the palette shows when it opens again: the last query, scope and selection. */
let memory: { query: string; scope: Scope; selected: string | null } = { query: "", scope: "all", selected: null };
/** Commands run from the palette in this session, newest first. */
const recent: string[] = [];

const isMac = () => navigator.platform.startsWith("Mac");

/** Mounted once in the shell. Ctrl K / Cmd K toggles it. */
export function CommandPalette() {
  const open = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => isOpen,
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup
        align="top"
        showCloseButton={false}
        aria-label="Command palette"
        className="h-[min(780px,calc(100vh-80px))] w-[min(1080px,calc(100vw-48px))] overflow-hidden"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody close={() => setOpen(false)} />
      </DialogPopup>
    </Dialog>
  );
}

const STALE_MS = 60_000;

function PaletteBody({ close }: { close: () => void }) {
  const [query, setQuery] = useState(memory.query);
  const [scope, setScope] = useState<Scope>(memory.scope);
  const [selected, setSelected] = useState<string | null>(memory.selected);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Data: the registry, plus cached lists for devices, profiles and pickers.
  useCommandIcons();
  const registry = useCommands();
  const auth = useQuery<AuthStatus>("auth.status");
  const signedIn = auth.data?.signedIn !== false;
  const devices = useQuery<DeviceList>("device.list", undefined, { enabled: signedIn });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { enabled: signedIn });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { enabled: signedIn });
  const permissions = useQuery<Permissions>("network.permissions", undefined, { enabled: signedIn });

  // Refetch lists older than a minute when the palette opens.
  useEffect(() => {
    const old = (at: number | null) => at !== null && Date.now() - at > STALE_MS;
    for (const q of [devices, profiles, eeros]) if (old(q.fetchedAt)) void q.refetch();
    // Only on open.
  }, []);

  const sources = useMemo(() => {
    const ctx = { signedIn, permissions: permissions.data ?? null };
    return {
      commands: commandItems(registry ?? [], ctx),
      pages: signedIn ? pageItems(ROUTES) : [],
      devices: signedIn ? deviceItems(devices.data?.devices ?? [], profiles.data ?? null, eeros.data ?? null) : [],
      profiles: signedIn ? profileItems(profiles.data ?? null) : [],
      recent,
    };
  }, [registry, signedIn, permissions.data, devices.data, profiles.data, eeros.data]);

  const result = useMemo(() => search(query, sources, scope), [query, sources, scope]);
  const hit = result.flat.find((h) => h.item.key === selected) ?? result.flat[0] ?? null;
  const item = hit?.item ?? null;

  useEffect(() => {
    memory = { query, scope, selected: item?.key ?? null };
  }, [query, scope, item?.key]);

  // Params for the selected command: defaults and preset, reset when the selection changes.
  const fields = useMemo(() => (item?.kind === "command" ? paramFields(item.info.params) : []), [item]);
  const [form, setForm] = useState<{ key: string | null; values: Record<string, unknown> }>({ key: null, values: {} });
  const values =
    form.key === item?.key ? form.values : item?.kind === "command" ? defaultParams(item.info.params, item.params) : {};
  const setValues = (v: Record<string, unknown>) => setForm({ key: item?.key ?? null, values: v });
  const chosen = item?.kind === "command" ? chosenParams(item.info.params, values) : {};
  const missing = item?.kind === "command" ? missingRequired(item.info.params, chosen) : [];
  // A required field nobody has filled in yet is marked, not an error message.
  const errors = Object.fromEntries(
    Object.entries(item?.kind === "command" ? validateParams(item.info.params, chosen) : {}).filter(([k]) => !missing.includes(k)),
  );

  const [run, setRun] = useState<{ key: string | null; state: RunState }>({ key: null, state: { running: false, result: null } });
  const runState = run.key === item?.key ? run.state : { running: false, result: null };

  const entities: EntityOptions = useMemo(
    () => ({
      device: sources.devices.map((d) => ({ value: d.label, label: d.label, hint: [d.state, d.context].filter(Boolean).join(" · ") || null })),
      profile: sources.profiles.map((p) => ({ value: p.label, label: p.label, hint: [p.state, p.context].filter(Boolean).join(" · ") || null })),
      eero: (eeros.data ?? []).map((e) => ({ value: e.location, label: e.location, hint: e.model })),
    }),
    [sources, eeros.data],
  );

  const blocked =
    item === null
      ? "Nothing selected"
      : item.kind !== "command"
        ? null
        : (item.unavailable ??
          (missing.length > 0 ? `Set ${missing.join(", ")} first` : Object.keys(errors).length > 0 ? "Fix the params first" : null));

  const runLabel = !item || item.kind === "command" ? "Run" : `Open ${item.label}`;

  const runItem = async (target: Item | null) => {
    if (!target) return;
    if (target.kind === "page") return void (close(), navigate(target.path));
    if (target.kind === "device") return void (close(), navigate(pathFor("device", { deviceId: target.id })));
    if (target.kind === "profile") return void (close(), navigate(pathFor("profile", { profileId: target.id })));
    if (target !== item || blocked !== null) return; // rows other than the selected one run after being selected
    const key = target.key;
    setRun({ key, state: { running: true, result: null } });
    const res = await execute(target.info.id, chosen);
    recent.splice(0, recent.length, key, ...recent.filter((k) => k !== key).slice(0, 9));
    setRun((r) => (r.key === key ? { key, state: { running: false, result: res } } : r));
  };

  const copyCli = async (): Promise<boolean> => {
    if (item?.kind !== "command") return false;
    try {
      await navigator.clipboard.writeText(cliLine(item.info.id, chosen, item.info.effect));
      return true;
    } catch {
      return false;
    }
  };

  const move = (step: number) => {
    const list = result.flat;
    if (list.length === 0) return;
    const at = item ? list.findIndex((h) => h.item.key === item.key) : -1;
    const next = list[(at + step + list.length) % list.length];
    if (next) setSelected(next.item.key);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runItem(item);
    } else if (e.key === "Tab" && !e.shiftKey) {
      const first = previewRef.current?.querySelector<HTMLElement>(
        "[data-params] :is(input, select, [role=radio][tabindex='0']):not(:disabled)",
      );
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if ((isMac() ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "c") {
      // Copy as CLI, unless the user is copying text from the input.
      const el = e.currentTarget;
      if (el.selectionStart === el.selectionEnd) {
        e.preventDefault();
        void copyCli();
      }
    }
  };

  // Enter in a params field runs too (not on buttons, which have their own Enter).
  const onPreviewKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && (t.tagName === "INPUT" || t.tagName === "SELECT")) {
      e.preventDefault();
      void runItem(item);
    }
  };

  const chips: { scope: Scope; label: string; count: number | null }[] = [
    { scope: "all", label: "All", count: null },
    ...KINDS.filter((k) => result.mode === "text" || k === "command").map((k) => ({
      scope: k as Scope,
      label: KIND_LABEL[k],
      count: result.counts[k],
    })),
  ];

  const listLoading = { device: signedIn && devices.data === undefined, profile: signedIn && profiles.data === undefined };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[58px] shrink-0 items-center gap-3 border-b px-[18px]">
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          onKeyDown={onInputKey}
          placeholder="Search commands, pages, devices and profiles"
          aria-label="Search or run a command"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={item ? `palette-${item.key}` : undefined}
          className="min-w-0 flex-1 bg-transparent font-medium text-[17px] outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
        />
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
          {result.total} {result.total === 1 ? "result" : "results"}
        </span>
        <div className="flex shrink-0 gap-1.5" role="radiogroup" aria-label="Scope">
          {chips.map((c) => {
            const Icon = c.scope === "all" ? null : KIND_ICON[c.scope];
            const on = scope === c.scope || (c.scope === "all" && result.mode === "id" && scope !== "command");
            return (
              <button
                key={c.scope}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={-1}
                onClick={() => {
                  setScope(c.scope);
                  setSelected(null);
                  inputRef.current?.focus();
                }}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none",
                  on ? "border-input bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3" />}
                {c.label}
                {c.count !== null && <span className="text-muted-foreground tabular-nums">{c.count}</span>}
              </button>
            );
          })}
        </div>
        <Keys keys={["Esc"]} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_440px]" id="palette-results">
        <PaletteResults
          groups={result.groups}
          counts={result.counts}
          selectedKey={item?.key ?? null}
          onSelect={setSelected}
          onRun={(key) => {
            const target = result.flat.find((h) => h.item.key === key)?.item ?? null;
            if (target && target.kind !== "command") void runItem(target);
            else setSelected(key);
          }}
          loading={listLoading}
          showLoading={result.mode === "text" && query.trim() !== "" && (scope === "all" || scope === "device" || scope === "profile")}
          commandCount={registry?.length ?? 0}
          empty={result.total === 0 && registry !== null}
        />
        <div ref={previewRef} onKeyDown={onPreviewKey} className="flex min-h-0 flex-col">
          {item ? (
            <PalettePreview
              item={item}
              fields={fields}
              values={values}
              chosen={chosen}
              onValuesChange={setValues}
              errors={errors}
              entities={entities}
              run={runState}
              onRun={() => void runItem(item)}
              blocked={blocked}
              runLabel={runLabel}
              onCopy={copyCli}
            />
          ) : (
            <div className="grid flex-1 place-items-center bg-card px-6 text-center text-muted-foreground text-sm">
              {registry === null ? "Loading commands..." : "Nothing to preview."}
            </div>
          )}
        </div>
      </div>

      <div className="flex h-[42px] shrink-0 items-center gap-4 border-t bg-muted/60 px-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={["↑", "↓"]} />
          Navigate
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={["↵"]} />
          Run
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={["Tab"]} />
          Edit params
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={isMac() ? ["⌘", "C"] : ["Ctrl", "C"]} />
          Copy as CLI
        </span>
        <span className="ms-auto">Effects</span>
        <EffectTag effect="query" />
        <EffectTag effect="write" />
        <EffectTag effect="disruptive" />
        <EffectTag effect="destructive" />
      </div>
    </div>
  );
}
