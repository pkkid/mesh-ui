/**
 * The command palette (docs/ux/pages/command-palette.md, mockup 19): one
 * search over every registry command, page, eero, device and profile, with a
 * preview that shows the same call as a CLI line and an MCP tool call.
 *
 * Opened by the titlebar search or its shortcut, F1 by default (`openPalette`). It is a
 * surface like the CLI: commands come from `window.mesh.commands()` and run
 * through `window.mesh.execute`; nothing here knows what a command does.
 * Pages, eeros, devices and profiles navigate. Queries run and show their result;
 * writes run through the write kit (`useWrite`): a toast for `write`, and
 * for `disruptive` and `destructive` a confirm dialog nested over the
 * palette, all built from the registry by `writeRequest` with no per-command code. A
 * write with an inverse in the registry toasts with Undo (`withUndo`), and
 * the preview shows "Running..." only once a confirm is answered.
 */
import { Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { navigate, pathFor } from "~/app/router";
import { ROUTES } from "~/app/routes";
import { execute, useCommands, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { AppSettings, AuthStatus, DeviceList, Eero, Network, Permissions, ProfileList } from "../../../../core/model";
import { KIND_LABEL, Keys, PaletteResults, useCommandIcons } from "./PaletteResults";
import type { EntityOptions } from "./ParamsForm";
import { PalettePreview, type RunState } from "./PalettePreview";
import {
  chosenParams,
  type Access,
  cliLine,
  cliRefusal,
  commandItems,
  defaultParams,
  deviceItems,
  eeroItems,
  type Item,
  KINDS,
  pageItems,
  placeItems,
  paramFields,
  profileItems,
  type Scope,
  search,
  surfacesFor,
  missingRequired,
  validateParams,
  writeRequest,
} from "./search";
import { withUndo } from "./undo";
import { placeShown, usePlaceContext } from "./placeRules";
import PLACES from "virtual:places";
import { revealPlace } from "~/lib/places";
import { copyText } from "~/lib/clipboard";
import { useShortcut } from "~/lib/shortcuts";

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

/** Mounted once in the shell. Its shortcut (F1 by default, Settings > Keyboard shortcuts) toggles it. */
export function CommandPalette() {
  const open = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => isOpen,
  );

  useShortcut("palette.open", () => setOpen(!isOpen));

  return (
    // Only Esc and the close button close it, never a click outside. Esc with focus anywhere but the search box
    // first takes focus back to the search box; a second Esc closes.
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key") {
          const input = document.querySelector<HTMLInputElement>("[data-palette-input]");
          if (input && document.activeElement !== input) {
            details.cancel();
            input.focus();
            return;
          }
        }
        setOpen(next);
      }}
    >
      <DialogPopup
        placement="palette"
        showCloseButton={false}
        aria-label="Command palette"
        // Exactly the main content's surface: the flat canvas.
        className="h-[min(780px,calc(100vh-80px))] w-[min(1080px,calc(100vw-48px))] overflow-hidden bg-background"
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
  const network = useQuery<Network>("network.get", undefined, { enabled: signedIn });
  // The command line and MCP access levels: commands neither allows are not listed, the preview shows only the
  // calls each allows, and Run follows the command line's level (the palette runs a command as the CLI would).
  const settings = useQuery<AppSettings>("app.settings.get");
  const access: Access | undefined = settings.data
    ? { cli: settings.data.cliAccess, mcp: settings.data.mcpAccess, secrets: settings.data.revealSecrets === true }
    : undefined;
  const accessKey = access ? `${access.cli}|${access.mcp}|${access.secrets}` : "";
  /** What each surface may do for an eero, device or profile's details read (a query). */
  const details = surfacesFor({ effect: "query", sensitive: false, access: null }, access);

  // Refetch lists older than a minute when the palette opens.
  useEffect(() => {
    const old = (at: number | null) => at !== null && Date.now() - at > STALE_MS;
    for (const q of [devices, profiles, eeros]) if (old(q.fetchedAt)) void q.refetch();
    // Only on open.
  }, []);

  // What the show-if rules read: cached reads the pages share; a cold one is read once on open, never per keystroke.
  const placeCtx = usePlaceContext(signedIn);

  const sources = useMemo(() => {
    const ctx = { signedIn, permissions: permissions.data ?? null, network: network.data ?? null, access };
    const cmds = registry ?? [];
    return {
      commands: commandItems(cmds, ctx),
      // Places: the pages, then every section and settings row the page would show now (placeRules.ts).
      pages: signedIn ? [...pageItems(ROUTES), ...placeItems(PLACES, ROUTES, (rule) => placeShown(rule, placeCtx))] : [],
      eeros: signedIn ? eeroItems(eeros.data ?? null) : [],
      devices: signedIn ? deviceItems(devices.data?.devices ?? [], profiles.data ?? null, eeros.data ?? null) : [],
      profiles: signedIn ? profileItems(profiles.data ?? null) : [],
      recent,
    };
    // accessKey stands for access, a new object each render.
  }, [registry, signedIn, permissions.data, network.data, devices.data, profiles.data, eeros.data, placeCtx, accessKey]);

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

  const entities: EntityOptions = useMemo(() => {
    // Send the name, as the CLI would, unless two entities share it; then the id.
    const pick = <T,>(list: ReadonlyArray<T>, id: (x: T) => string, name: (x: T) => string, hint: (x: T) => string | null) => {
      const seen = new Map<string, number>();
      for (const x of list) seen.set(name(x).toLowerCase(), (seen.get(name(x).toLowerCase()) ?? 0) + 1);
      return list.map((x) => {
        const dup = (seen.get(name(x).toLowerCase()) ?? 0) > 1;
        return { value: dup ? id(x) : name(x), label: dup ? `${name(x)} (${id(x)})` : name(x), hint: hint(x) };
      });
    };
    const ctx = (x: { state: string | null; context: string }) => [x.state, x.context].filter(Boolean).join(" · ") || null;
    return {
      device: pick(sources.devices, (d) => d.id, (d) => d.label, ctx),
      profile: pick(sources.profiles, (p) => p.id, (p) => p.label, ctx),
      eero: pick(eeros.data ?? [], (e) => e.id, (e) => e.location, (e) => e.model),
    };
  }, [sources, eeros.data]);

  const blocked =
    item === null
      ? "Nothing selected"
      : item.kind !== "command"
        ? null
        : !item.cli
          ? cliRefusal(access)
          : (item.unavailable ??
          (missing.length > 0 ? `Set ${missing.join(", ")} first` : Object.keys(errors).length > 0 ? "Fix the params first" : null));

  // A change asks first (a confirm), so its button ends in an ellipsis; a query runs at once.
  const runLabel = !item || item.kind === "command" ? (item && item.info.effect !== "query" ? "Run command\u2026" : "Run command") : `Go to ${item.label}`;

  // Writes: one useWrite for whatever is selected. Its confirm is a dialog
  // nested over the palette, so focus and Esc stay with it.
  const writeId = item?.kind === "command" ? item.info.id : "";
  const write = useWrite(writeId, { confirmIn: "nested" });
  const busy = write.running || write.asking !== null;

  // A confirm belongs to the item it was asked for.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (write.asking && askedFor.current !== item?.key) write.answer(false);
  }, [item?.key, write.asking, write.answer]);

  const remember = (key: string) => recent.splice(0, recent.length, key, ...recent.filter((k) => k !== key).slice(0, 9));

  const runItem = async (target: Item | null) => {
    if (!target) return;
    if (target.kind === "page") {
      close();
      navigate(target.path);
      // A section or setting: scroll to it once its page draws it, and ring it briefly.
      if (target.anchor) revealPlace(target.anchor);
      return;
    }
    if (target.kind === "eero") return void (close(), navigate(pathFor("eero", { eeroId: target.id })));
    if (target.kind === "device") return void (close(), navigate(pathFor("device", { deviceId: target.id })));
    if (target.kind === "profile") return void (close(), navigate(pathFor("profile", { profileId: target.id })));
    if (target !== item || blocked !== null || busy) return; // rows other than the selected one run after being selected
    const key = target.key;
    setRun({ key, state: { running: true, result: null } });
    let res: Awaited<ReturnType<typeof execute>> | null;
    if (target.info.effect === "query") {
      res = await execute(target.info.id, chosen);
    } else {
      askedFor.current = key;
      const { id: _id, params, ...options } = withUndo(writeRequest(target.info, target.label, chosen, fields), target.info, registry ?? [], network.data?.id ?? null);
      // Every change from the palette asks first: disruptive and destructive through the engine's confirm, a plain
      // write through the same dialog (askFirst; it sends no `confirm`). Only queries run straight away.
      res = await write.run(params, target.info.effect === "write" ? { ...options, ...askWrite(target.label, target.info.description) } : options);
      inputRef.current?.focus(); // the confirm had focus; keep the keyboard on the palette
    }
    if (res) remember(key);
    setRun((r) => (r.key === key ? { key, state: { running: false, result: res } } : r));
  };

  /** The ask-first confirm for a plain write: its label as the title, what it does as the message. */
  const askWrite = (label: string, description: string | null | undefined) => ({
    askFirst: true,
    confirm: {
      title: `${label.replace(/\u2026$|\.\.\.$/, "")}?`,
      message: description || "This changes your network. You can undo it from the toast afterwards.",
      confirmLabel: label.replace(/\u2026$|\.\.\.$/, ""),
    },
  });

  /** Runs the selected eero, device or profile's details read (`device.get`, ...) in line, as a query command runs. */
  const runDetails = async () => {
    if (!item || (item.kind !== "eero" && item.kind !== "device" && item.kind !== "profile") || !details.cli) return;
    const key = item.key;
    setRun({ key, state: { running: true, result: null } });
    const res = await execute(`${item.kind}.get`, { [item.kind]: item.id });
    setRun((r) => (r.key === key ? { key, state: { running: false, result: res } } : r));
  };

  /** The highlighted result's CLI line: the command with its chosen params, or an eero, device or profile's details read. */
  const copyCli = async (): Promise<boolean> => {
    let line: string | null = null;
    if (item?.kind === "command") line = item.cli ? cliLine(item.info.id, chosen, item.info.effect) : null;
    else if ((item?.kind === "eero" || item?.kind === "device" || item?.kind === "profile") && details.cli) line = cliLine(`${item.kind}.get`, { [item.kind]: item.id }, "query");
    if (line === null) return false; // a place has no command, and the command line's level may not allow it
    try {
      return await copyText(line, { toast: "Copied the CLI command" });
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
        "[data-params] :is(input, select, button, [role=combobox]):not(:disabled)",
      );
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  /**
   * Ctrl+Shift+C (Cmd+Shift+C) copies the highlighted result's CLI line whenever the palette is open, wherever focus
   * is (the search box, a params field, a button, the dialog itself). Plain Ctrl+C is the system copy and is never
   * taken over. A window listener, since focus can sit on the dialog popup, outside this body.
   */
  const copyRef = useRef(copyCli);
  copyRef.current = copyCli;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!((isMac() ? e.metaKey : e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c")) return;
      e.preventDefault();
      void copyRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Enter in a params field runs too (not on buttons, which have their own Enter).
  const onPreviewKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && (t.tagName === "INPUT" || t.tagName === "SELECT")) {
      e.preventDefault();
      void runItem(item);
    }
  };

  const chips: { scope: Scope; label: string; count: number | null }[] = [
    { scope: "all", label: "All", count: result.total },
    ...KINDS.filter((k) => result.mode === "text" || k === "command").map((k) => ({
      scope: k as Scope,
      label: KIND_LABEL[k],
      count: result.counts[k],
    })),
  ];

  // An id search ("device.") shows commands only; "All" then reads as the active scope unless Commands is picked.
  const activeScope: Scope = result.mode === "id" && scope !== "command" ? "all" : scope;

  const listLoading = {
    eero: signedIn && eeros.data === undefined,
    device: signedIn && devices.data === undefined,
    profile: signedIn && profiles.data === undefined,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[58px] shrink-0 items-center gap-3 px-[18px]">
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          data-palette-input=""
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          onKeyDown={onInputKey}
          placeholder="Search commands, places, eeros, devices and profiles"
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
        {/* What to search: a dropdown (two clicks, but a much calmer header than a row of pills), each kind with its count. */}
        <Select
          items={chips.map((c) => ({ value: c.scope, label: c.label }))}
          value={activeScope}
          onValueChange={(v) => {
            if (!v) return;
            setScope(v as Scope);
            setSelected(null);
          }}
          // Picking a scope or Esc closes the list: typing goes on in the search box. The dropdown hands focus back to
          // its trigger as it closes, so this waits a frame and takes it after.
          onOpenChange={(open) => {
            if (!open) requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <SelectTrigger size="tool" className="w-36 shrink-0" aria-label="Search in">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {chips.map((c) => (
              <SelectItem key={c.scope} value={c.scope}>
                <span className="flex w-full items-center gap-2">
                  <span className="flex-1">{c.label}</span>
                  {c.count !== null && <span className="text-muted-foreground tabular-nums">{c.count}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {/* Close: Esc closes it too (a click outside does not). */}
        <Button size="icon-sm" variant="ghost-muted" aria-label="Close" title="Close (Esc)" onClick={close}>
          <X />
        </Button>
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
          showLoading={result.mode === "text" && query.trim() !== "" && (scope === "all" || scope === "eero" || scope === "device" || scope === "profile")}
          empty={result.total === 0 && registry !== null}
        />
        {/* The preview is its own panel running to the palette's right and bottom edges, in exactly the navigation sidebar's surface, with 1px top and left borders and a rounded top-left corner. */}
        <div
          ref={previewRef}
          onKeyDown={onPreviewKey}
          data-sidebar-surface=""
          className="ms-2.5 flex min-h-0 flex-col overflow-hidden rounded-tl-xl border-t border-l bg-sidebar surface-grain"
        >
          {item ? (
            <PalettePreview
              item={item}
              fields={fields}
              values={values}
              chosen={chosen}
              onValuesChange={setValues}
              errors={errors}
              entities={entities}
              run={write.asking ? { ...runState, running: false } : runState}
              onRun={() => void runItem(item)}
              onRunDetails={() => void runDetails()}
              blocked={blocked}
              details={details}
              runLabel={runLabel}
              onCopy={copyCli}
            />
          ) : (
            <div className="grid flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
              {registry === null ? "Loading commands..." : "Nothing to preview."}
            </div>
          )}
        </div>
      </div>

      <WriteConfirmDialog write={write} />

      <div className="flex h-[42px] shrink-0 items-center gap-4 border-t bg-muted/60 px-4 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={["↑", "↓"]} />
          Navigate
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keys keys={["↵"]} />
          Run, Go to
        </span>
        {/* Tab still moves into the params; it is what people expect, so the footer does not list it. */}
        {access?.cli !== "off" && (
          <span className="inline-flex items-center gap-1.5">
            <Keys keys={isMac() ? ["⌘", "⇧", "C"] : ["Ctrl", "Shift", "C"]} />
            Copy as CLI
          </span>
        )}
      </div>
    </div>
  );
}
