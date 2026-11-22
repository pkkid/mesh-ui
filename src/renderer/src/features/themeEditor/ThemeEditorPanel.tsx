/**
 * The floating theme editor, ported from T3 Code's `ThemeEditorPanel.tsx`
 * (MIT) and trimmed to Mesh UI (docs/ux/pages/settings.md, Theme editor).
 *
 * A panel in the bottom right of the window that can be dragged by its
 * header, resized from its corner and minimised. The page stays usable
 * behind it and shows the draft live (`setThemePreview`), so changes are
 * judged on the real UI. It edits the name, the light and dark palettes the
 * theme has, either simply (a background and an accent derive the rest) or
 * colour by colour in groups, plus the chart colours. Picking a colour's
 * name spotlights everywhere it is used; Inspect names the colour under the
 * pointer. Save writes the theme library; Cancel puts the picked theme back.
 * Pure view state, not a command.
 */
import { ChevronDown, ChevronUp, MousePointer2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { popoverSurface } from "~/components/ui/popover";
import { Segmented } from "~/components/ui/segmented";
import { toast } from "~/components/ui/toast";
import { createVividThemeColors, parseColor, updateThemeColorFamily } from "~/lib/themeColor";
import { freeThemeId, installThemes, updateTheme } from "~/lib/themeLibrary";
import {
  MID_TONE_SERIES,
  SERIES_HUES,
  getSeriesForAppearance,
  getThemeColorsForAppearance,
  getThemeModes,
  themeVariable,
  type SeriesPalette,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "~/lib/themePalettes";
import { pickThemeEverywhere, setThemePreview } from "~/lib/themes";
import { cn } from "~/lib/utils";
import { themeIdFromName } from "~/lib/vscodeTheme";

import { ThemeColorField } from "./ThemeColorField";
import { FAMILY_BY_VARIABLE, HUE_BY_VARIABLE, ROLE_GROUPS, SERIES_LABELS, SIMPLE_ROLES, seriesVariable, variableLabel } from "./themeEditorRoles";
import {
  clearInspectorHighlights,
  clearInspectorHover,
  highlightVariableUsage,
  inspectElement,
  inspectFromUtilities,
  refreshInspectorSpotlight,
  showInspectorHover,
  type ElementInspection,
} from "./themeInspector";

type ByAppearance<T> = Record<ThemeAppearance, T>;

/** Colours every appearance starts with: the source theme's where it has them. */
function initialDraft(source: ThemeDefinition | null) {
  const colors = {} as ByAppearance<ThemeColors>;
  const series = {} as ByAppearance<SeriesPalette>;
  for (const mode of ["light", "dark"] as const) {
    colors[mode] = source && getThemeModes(source).includes(mode) ? getThemeColorsForAppearance(source, mode) : createVividThemeColors(mode, mode === "dark" ? "#18181b" : "#fafafa", "#1b4ed8");
    series[mode] = source ? getSeriesForAppearance(source, mode) : MID_TONE_SERIES[mode];
  }
  return { colors, series };
}

const PANEL_MARGIN = 8;
const PANEL_MIN_WIDTH = 280;
const PANEL_MIN_HEIGHT = 220;

/** Keeps the panel inside the window sideways; below, only its header must stay visible. */
function clampPosition(viewport: { width: number; height: number }, x: number, y: number, width: number) {
  return {
    x: Math.min(Math.max(x, PANEL_MARGIN), Math.max(PANEL_MARGIN, viewport.width - width - PANEL_MARGIN)),
    y: Math.min(Math.max(y, PANEL_MARGIN), Math.max(PANEL_MARGIN, viewport.height - 48)),
  };
}

const MAX_NAME = 48;

const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight });
let viewport = typeof window === "undefined" ? { width: 0, height: 0 } : readViewport();
function useViewport() {
  return useSyncExternalStore(
    (listener) => {
      const update = () => {
        viewport = readViewport();
        listener();
      };
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    },
    () => viewport,
  );
}

export function ThemeEditorPanel({
  editingTheme,
  seedTheme,
  seedName,
  initialAppearance,
  onClose,
}: {
  /** A saved theme to change, or null to create one. */
  editingTheme: ThemeDefinition | null;
  /** What a new theme starts from (Duplicate). */
  seedTheme: ThemeDefinition | null;
  seedName: string | null;
  initialAppearance: ThemeAppearance;
  onClose: () => void;
}) {
  const source = editingTheme ?? seedTheme;
  const isEditing = editingTheme !== null;
  const modes: ReadonlyArray<ThemeAppearance> = source ? getThemeModes(source) : ["light", "dark"];
  const [name, setName] = useState(() => editingTheme?.label ?? seedName ?? "");
  const [appearance, setAppearance] = useState<ThemeAppearance>(() => (modes.includes(initialAppearance) ? initialAppearance : (modes[0] ?? "light")));
  // Saved themes are hand-tuned (VS Code imports, built-ins), so the editor opens on every colour.
  const [advanced, setAdvanced] = useState(source !== null);
  const [draft, setDraft] = useState(() => initialDraft(source));
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [query, setQuery] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number; width: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef<typeof draft | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number; width: number } | null>(null);
  const resizeStart = useRef<{ pointerX: number; pointerY: number; left: number; top: number; width: number; height: number } | null>(null);

  const colors = draft.colors[appearance];
  const series = draft.series[appearance];

  // The window shows the draft while the editor is open, and the picked theme again when it closes.
  useEffect(() => {
    setThemePreview({ colors, series, appearance });
  }, [colors, series, appearance]);
  useEffect(() => () => setThemePreview(null), []);

  const updateVariable = useCallback(
    (variable: string, value: string) => {
      if (!parseColor(value)) return;
      setDraft((current) => {
        const hue = HUE_BY_VARIABLE.get(variable);
        if (hue) return { ...current, series: { ...current.series, [appearance]: { ...current.series[appearance], [hue]: value } } };
        const role = FAMILY_BY_VARIABLE.get(variable)?.role ?? (variable === themeVariable("canvas") ? "canvas" : "accent");
        const now = current.colors[appearance];
        const next = advanced
          ? updateThemeColorFamily(appearance, now, role, value)
          : createVividThemeColors(appearance, role === "canvas" ? value : now.canvas, role === "accent" ? value : now.accent);
        return { ...current, colors: { ...current.colors, [appearance]: next } };
      });
    },
    [advanced, appearance],
  );

  // An edit can re-derive a whole palette, so Escape in a picker restores the snapshot, not one value.
  const latest = useRef(draft);
  latest.current = draft;
  const startEdit = useCallback(() => {
    snapshot.current = latest.current;
  }, []);
  const cancelEdit = useCallback(() => {
    if (snapshot.current) setDraft(snapshot.current);
    snapshot.current = null;
  }, []);

  const selectVariable = useCallback((variable: string, reveal = false) => {
    const family = FAMILY_BY_VARIABLE.get(variable);
    const shown = family ? themeVariable(family.role) : variable;
    setSelected(shown);
    if (family && !SIMPLE_ROLES.includes(family.role)) {
      setAdvanced(true);
      setQuery("");
    }
    if (!reveal) return;
    requestAnimationFrame(() => {
      panelRef.current?.querySelector(`[data-theme-color-variable="${shown}"]`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
    });
  }, []);
  const toggleSelected = useCallback((variable: string) => setSelected((current) => (current === variable ? null : variable)), []);
  const clearInspector = useCallback(() => {
    setSelected(null);
    setUsage(null);
    setInspecting(false);
  }, []);

  // Spotlight every element the selected colour paints. Live pages re-render on polls, so refresh at most twice a second.
  const highlightKey = selected ? (FAMILY_BY_VARIABLE.get(selected)?.roles.map(themeVariable) ?? [selected]).join(",") : "";
  useEffect(() => {
    clearInspectorHighlights();
    if (!highlightKey || inspecting) return;
    const variables = highlightKey.split(",");
    const refresh = () => setUsage(highlightVariableUsage(variables));
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = performance.now();
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(
        () => {
          timer = null;
          last = performance.now();
          refresh();
        },
        Math.max(0, 500 - (performance.now() - last)),
      );
    };
    const observer = new MutationObserver((mutations) => {
      const ours = mutations.every((m) => m.target instanceof Element && m.target.closest("#theme-inspector-spotlight, [data-theme-editor-panel]"));
      if (!ours) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let frame: number | null = null;
    const redraw = () => {
      if (frame === null) frame = requestAnimationFrame(() => ((frame = null), refreshInspectorSpotlight()));
    };
    window.addEventListener("resize", redraw);
    window.addEventListener("scroll", redraw, true);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", redraw);
      window.removeEventListener("scroll", redraw, true);
      clearInspectorHighlights();
      setUsage(null);
    };
  }, [highlightKey, inspecting]);

  // Inspect mode: hover names the colour under the pointer; a click selects it and leaves the mode.
  useEffect(() => {
    if (!inspecting) return clearInspectorHover();
    let disarm = false;
    let hoverTarget: Element | null = null;
    let hoverInspection: ElementInspection | null = null;
    let hoverTimer: number | null = null;
    const inEditor = (target: Element): boolean => target.closest("[data-theme-editor-panel]") !== null;
    const clearHover = () => {
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTimer = null;
      hoverTarget = null;
      hoverInspection = null;
      clearInspectorHover();
    };
    const show = (inspection: ElementInspection) => {
      hoverInspection = inspection;
      showInspectorHover(inspection, variableLabel(inspection.variable));
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || inEditor(target)) return clearHover();
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTarget = target;
      hoverInspection = null;
      const quick = inspectFromUtilities(target);
      if (quick) return show(quick);
      clearInspectorHover();
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (hoverTarget !== target || !target.isConnected) return;
        const found = inspectElement(target);
        if (found) show(found);
      }, 140);
    };
    const onPointerOut = (event: PointerEvent) => event.relatedTarget === null && clearHover();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || inEditor(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const found = hoverTarget === target && hoverInspection ? hoverInspection : inspectElement(target);
      if (!found) return;
      clearHover();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      selectVariable(found.variable, true);
      disarm = true;
    };
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || inEditor(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (disarm) setInspecting(false);
      disarm = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape leaves inspecting only; nothing behind the editor sees it.
      event.preventDefault();
      event.stopImmediatePropagation();
      clearHover();
      clearInspector();
    };
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", clearHover, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", clearHover, true);
      clearHover();
    };
  }, [inspecting, selectVariable, clearInspector]);

  const save = () => {
    const label = name.trim();
    if (!label) return setError("Name your theme first.");
    if (label.length > MAX_NAME) return setError(`Keep the name to ${MAX_NAME} characters or fewer.`);
    const base = editingTheme ?? seedTheme;
    const main: ThemeAppearance = base && modes.includes(base.appearance) ? base.appearance : (modes[0] ?? "light");
    const other: ThemeAppearance = main === "light" ? "dark" : "light";
    const theme: ThemeDefinition = {
      id: editingTheme?.id ?? freeThemeId(themeIdFromName(label)),
      label,
      appearance: main,
      colors: draft.colors[main],
      ...(modes.includes(other) ? { variants: { [other]: draft.colors[other] } } : {}),
      ...(editingTheme?.collection ? { collection: editingTheme.collection } : {}),
      series: Object.fromEntries(modes.map((mode) => [mode, draft.series[mode]])),
    };
    if (editingTheme) {
      if (!updateTheme(theme)) return setError("This theme was removed. Close the editor and duplicate another.");
      toast.success(`${label} saved`);
    } else {
      const [installed] = installThemes([theme]);
      if (installed) pickThemeEverywhere(installed);
      toast.success(`${label} created`);
    }
    onClose();
  };

  const field = (variable: string, label: string, value: string) => (
    <ThemeColorField
      key={variable}
      variable={variable}
      label={label}
      value={value}
      selected={selected === variable}
      onChange={updateVariable}
      onEditStart={startEdit}
      onEditCancel={cancelEdit}
      onSelect={selectVariable}
      onToggleSelected={toggleSelected}
    />
  );

  const q = query.trim().toLowerCase();
  const groups = ROLE_GROUPS.map((group) => ({
    ...group,
    families: group.families.filter((f) => !q || `${f.label} ${f.roles.join(" ")}`.toLowerCase().includes(q)),
  })).filter((group) => group.families.length > 0);
  const hues = SERIES_HUES.filter((hue) => !q || `chart ${SERIES_LABELS[hue]} ${hue}`.toLowerCase().includes(q));

  // Geometry is kept as the user left it and fitted to the window here, so a window that shrinks and grows back
  // returns the panel to where it was.
  const view = useViewport();
  const shownSize = size && {
    width: Math.max(PANEL_MIN_WIDTH, Math.min(size.width, view.width - PANEL_MARGIN * 2)),
    height: Math.max(PANEL_MIN_HEIGHT, Math.min(size.height, view.height - PANEL_MARGIN * 2)),
  };
  const shownPosition = position && clampPosition(view, position.x, position.y, shownSize?.width ?? position.width);

  const onDragDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: event.clientX - rect.x, dy: event.clientY - rect.y, width: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    setPosition({ ...clampPosition(readViewport(), event.clientX - offset.dx, event.clientY - offset.dy, offset.width), width: offset.width });
  };
  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    // Resize from where the panel is drawn, so its top-left corner stays put.
    setPosition({ ...clampPosition(readViewport(), rect.x, rect.y, rect.width), width: rect.width });
    resizeStart.current = { pointerX: event.clientX, pointerY: event.clientY, left: rect.x, top: rect.y, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setSize({
      width: Math.min(Math.max(start.width + event.clientX - start.pointerX, PANEL_MIN_WIDTH), Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN - start.left)),
      height: Math.min(Math.max(start.height + event.clientY - start.pointerY, PANEL_MIN_HEIGHT), Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN - start.top)),
    });
  };

  const title = isEditing ? "Edit theme" : "Create theme";
  const status = inspecting
    ? "Select an element · Esc to cancel"
    : selected
      ? `${variableLabel(selected)} · ${usage ?? 0} ${usage === 1 ? "use" : "uses"}`
      : "Select a colour below";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      data-theme-editor-panel
      className={cn(
        popoverSurface,
        "no-drag fixed z-[46] flex max-h-[min(42rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden",
        position === null && "right-4 bottom-4",
        minimized && "max-h-none",
      )}
      style={{
        ...(shownPosition ? { left: shownPosition.x, top: shownPosition.y } : {}),
        ...(shownSize ? { width: shownSize.width } : {}),
        ...(shownSize && !minimized ? { height: shownSize.height, maxHeight: "calc(100dvh - 1rem)" } : {}),
      }}
      onKeyDown={(event) => {
        // Popovers opened from the editor are portaled outside it and handle their own Escape.
        if (event.key !== "Escape" || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex cursor-grab touch-none select-none items-center gap-1 border-b px-3 py-2 active:cursor-grabbing"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={() => (dragOffset.current = null)}
        onPointerCancel={() => (dragOffset.current = null)}
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 font-medium text-sm text-foreground">{title}</h2>
          {!minimized && <p className="truncate text-muted-foreground text-xs">{status}</p>}
        </div>
        <Button
          size="xs"
          variant={inspecting ? "secondary" : "ghost"}
          aria-pressed={inspecting}
          title={inspecting ? "Cancel and clear the selection" : "Pick a colour from the app"}
          onClick={() => (inspecting ? clearInspector() : setInspecting(true))}
        >
          <MousePointer2 />
          {inspecting ? "Cancel" : "Inspect"}
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label={minimized ? "Expand the theme editor" : "Minimise the theme editor"} title={minimized ? "Expand" : "Minimise"} onClick={() => setMinimized(!minimized)}>
          {minimized ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close the theme editor" title="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      {!minimized && (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 ps-3 pe-1.5">
            <Row label="Name">
              <Input
                autoFocus
                aria-label="Theme name"
                maxLength={MAX_NAME}
                placeholder="e.g. Aurora"
                value={name}
                className="h-7 text-xs [&_input]:h-[26px]"
                onChange={(e) => {
                  setName(e.currentTarget.value);
                  setError(null);
                }}
              />
            </Row>
            {error && (
              <p aria-live="polite" className="text-destructive-foreground text-xs">
                {error}
              </p>
            )}
            <Row label="Appearance">
              <Segmented
                aria-label="Palette to edit"
                value={appearance}
                onValueChange={setAppearance}
                options={(["light", "dark"] as const).map((mode) => ({
                  value: mode,
                  label: mode === "light" ? "Light" : "Dark",
                  disabled: !modes.includes(mode),
                  title: modes.includes(mode) ? undefined : `${source?.label ?? "This theme"} has no ${mode} palette`,
                }))}
              />
            </Row>
            <Row label="Colours" detail={advanced ? undefined : "Two colours, the rest derived"}>
              <Segmented
                aria-label="Colour mode"
                value={advanced ? "advanced" : "simple"}
                onValueChange={(v) => {
                  setAdvanced(v === "advanced");
                  const family = selected ? FAMILY_BY_VARIABLE.get(selected) : undefined;
                  if (v === "simple" && family && !SIMPLE_ROLES.includes(family.role)) setSelected(null);
                }}
                options={[
                  { value: "simple", label: "Simple", title: "A background and an accent derive every other colour" },
                  { value: "advanced", label: "Advanced", title: "Every colour, grouped by area" },
                ]}
              />
            </Row>
            {advanced && <Input aria-label="Filter colours" type="search" placeholder="Filter colours" value={query} className="h-7 text-xs [&_input]:h-[26px]" onChange={(e) => setQuery(e.currentTarget.value)} />}

            {advanced ? (
              <>
                {groups.map((group) => (
                  <Group key={group.id} title={group.title}>
                    {group.families.map((f) => field(themeVariable(f.role), f.label, colors[f.role]))}
                  </Group>
                ))}
              </>
            ) : (
              <Group title="Theme">{SIMPLE_ROLES.map((role) => field(themeVariable(role), role === "canvas" ? "Background" : "Accent", colors[role]))}</Group>
            )}
            {hues.length > 0 && (
              <Group title="Chart colours" detail="Series and status dots: download, bands, each eero">
                {hues.map((hue) => field(seriesVariable(hue), SERIES_LABELS[hue], series[hue]))}
              </Group>
            )}
            {advanced && groups.length === 0 && hues.length === 0 && <p className="text-muted-foreground text-xs">No matches.</p>}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={!name.trim()} onClick={save}>
              {isEditing ? "Save changes" : "Create theme"}
            </Button>
          </div>
          <div
            aria-hidden
            className="absolute right-0 bottom-0 z-10 flex size-5 cursor-se-resize touch-none select-none items-end justify-end p-1 text-muted-foreground/70"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={() => (resizeStart.current = null)}
            onPointerCancel={() => (resizeStart.current = null)}
          >
            <svg className="size-2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" viewBox="0 0 8 8">
              <path d="M7 1 1 7M7 4.5 4.5 7" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, detail, children }: { label: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3 pe-1.5">
      <div className="min-w-0">
        <div className="font-medium text-foreground text-xs">{label}</div>
        {detail && <div className="text-2xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

function Group({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="px-2">
        <h3 className="font-medium text-foreground text-xs">{title}</h3>
        {detail && <p className="text-2xs text-muted-foreground">{detail}</p>}
      </div>
      <div className="grid gap-0.5">{children}</div>
    </section>
  );
}
