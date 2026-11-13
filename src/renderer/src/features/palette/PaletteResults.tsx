/**
 * The palette's result list (docs/ux/pages/command-palette.md#layout):
 * grouped rows for commands, pages, devices and profiles with the match
 * highlighted, plus the shared bits the preview also uses (effect tag,
 * command icon, highlight).
 */
import {
  FileText,
  Lightbulb,
  type LucideIcon,
  MonitorSmartphone,
  Router,
  Settings,
  Terminal,
  Users,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { IconTile } from "~/components/ui/hero";
import { Status } from "~/components/ui/status";
import { effectColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import type { Effect } from "../../../../core/model";
import { type Hit, highlightParts, type Item, type Kind, type Range } from "./search";

export const KIND_LABEL: Record<Kind, string> = { command: "Commands", page: "Pages", device: "Devices", profile: "Profiles" };
export const KIND_ICON: Record<Kind, LucideIcon> = { command: Terminal, page: FileText, device: MonitorSmartphone, profile: Users };

/** Fallback icons by command area when the spec names none. */
const AREA_ICON: Record<string, LucideIcon> = {
  device: MonitorSmartphone,
  profile: Users,
  eero: Router,
  wifi: Wifi,
  app: Settings,
};

const pascal = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/**
 * Every lucide icon by name, for the icon names command specs carry. It is
 * about 1.6 MB, so it loads in its own chunk the first time the palette
 * opens; until then rows show their area icon.
 */
let iconMap: Record<string, LucideIcon> | null = null;
let iconLoad: Promise<void> | null = null;
const iconListeners = new Set<() => void>();

export function useCommandIcons(): void {
  useSyncExternalStore(
    (l) => (iconListeners.add(l), () => iconListeners.delete(l)),
    () => iconMap,
  );
  useEffect(() => {
    iconLoad ??= import("lucide-react/dist/esm/icons/index.mjs" as string)
      .then((m: Record<string, LucideIcon>) => {
        iconMap = m;
        iconListeners.forEach((l) => l());
      })
      .catch(() => {});
  }, []);
}

/** The lucide icon a command spec names ("circle-user"), else its area icon. */
export function commandIcon(id: string, icon: string | null): LucideIcon {
  const named = icon && iconMap ? iconMap[pascal(icon)] : undefined;
  return named ?? AREA_ICON[id.split(".")[0] ?? ""] ?? Terminal;
}

export function itemIcon(item: Item): LucideIcon {
  if (item.kind === "command") return commandIcon(item.info.id, item.info.icon);
  if (item.kind === "device") return deviceIcon(item.device);
  if (item.kind === "profile") return Users;
  return FileText;
}

/** Effect tag: a fixed colour dot on a neutral mono badge. */
export function EffectTag({ effect, className }: { effect: Effect; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-muted px-1.5 font-mono font-semibold text-[10.5px] text-foreground/80",
        className,
      )}
    >
      <span aria-hidden className="size-[5px] rounded-full" style={{ background: effectColors[effect] }} />
      {effect}
    </span>
  );
}

export function Highlight({ text, ranges }: { text: string; ranges: ReadonlyArray<Range> }) {
  if (ranges.length === 0) return <>{text}</>;
  return (
    <>
      {highlightParts(text, ranges).map((p, i) =>
        p.hit ? (
          <mark
            key={i}
            className="bg-transparent font-semibold text-foreground underline decoration-muted-foreground/60 underline-offset-2"
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function Keys({ keys, className }: { keys: ReadonlyArray<string>; className?: string }) {
  return (
    <span className={cn("inline-flex gap-[3px]", className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-input bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground shadow-[0_1px_0_var(--color-input)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

type ResultsProps = {
  groups: { kind: Kind; hits: Hit[] }[];
  counts: Record<Kind, number>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onRun: (key: string) => void;
  /** Device and profile groups are still loading. */
  loading: { device: boolean; profile: boolean };
  showLoading: boolean;
  commandCount: number;
  empty: boolean;
};

export function PaletteResults({ groups, counts, selectedKey, onSelect, onRun, loading, showLoading, commandCount, empty }: ResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view as the keyboard moves it.
  useEffect(() => {
    if (!selectedKey) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const loadingKinds = showLoading ? (["device", "profile"] as const).filter((k) => loading[k]) : [];

  return (
    <div ref={listRef} role="listbox" aria-label="Results" className="min-h-0 overflow-y-auto border-e px-2 pt-1.5 pb-2">
      {empty && (
        <p className="px-2.5 pt-6 pb-2 text-center text-muted-foreground text-sm">No commands, devices or profiles match.</p>
      )}
      {groups.map((g) => {
        const Icon = KIND_ICON[g.kind];
        return (
          <div key={g.kind} role="group" aria-label={KIND_LABEL[g.kind]}>
            <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1 font-semibold text-[10.5px] text-muted-foreground/80 uppercase tracking-widest">
              <Icon className="size-3" />
              {KIND_LABEL[g.kind]}
              <span className="ms-auto font-medium tabular-nums tracking-normal">{counts[g.kind]}</span>
            </div>
            {g.hits.map((hit) => (
              <ResultRow
                key={hit.item.key}
                hit={hit}
                selected={hit.item.key === selectedKey}
                onSelect={() => onSelect(hit.item.key)}
                onRun={() => onRun(hit.item.key)}
              />
            ))}
          </div>
        );
      })}
      {loadingKinds.map((k) => (
        <div key={k}>
          <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1 font-semibold text-[10.5px] text-muted-foreground/80 uppercase tracking-widest">
            {KIND_LABEL[k]}
          </div>
          <div className="px-2.5 py-1.5 text-muted-foreground text-xs">Loading...</div>
        </div>
      ))}
      <div className="mx-2.5 mt-3.5 flex items-center gap-1.5 rounded-[10px] border border-input border-dashed px-3 py-2.5 text-muted-foreground text-xs">
        <Lightbulb className="size-3.5 shrink-0" />
        Type <Keys keys={[">"]} /> to search all {commandCount} commands by id, like
        <span className="font-mono text-foreground/80">&gt;eero.list</span>
      </div>
    </div>
  );
}

function ResultRow({ hit, selected, onSelect, onRun }: { hit: Hit; selected: boolean; onSelect: () => void; onRun: () => void }) {
  const { item } = hit;
  const Icon = itemIcon(item);
  const dim = item.kind === "command" && item.unavailable !== null;
  return (
    <div
      role="option"
      id={`palette-${item.key}`}
      aria-selected={selected}
      data-key={item.key}
      onMouseMove={selected ? undefined : onSelect}
      onClick={onRun}
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-[7px]",
        selected ? "bg-muted shadow-[inset_0_0_0_1px_var(--color-input)]" : "hover:bg-muted/50",
        selected && "before:-start-2 before:absolute before:inset-y-[9px] before:w-[3px] before:rounded-e-[3px] before:bg-muted-foreground",
      )}
    >
      {item.kind === "profile" ? (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-muted font-semibold text-[11px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
        >
          {item.label.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <IconTile icon={Icon} size={item.kind === "command" ? "md" : "sm"} className={cn(dim && "opacity-60")} />
      )}

      {item.kind === "command" ? (
        <div className={cn("min-w-0 grow", dim && "opacity-60")}>
          <div className="truncate font-medium text-[13.5px]">
            <Highlight text={item.label} ranges={hit.ranges} />
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            <Highlight text={item.info.id} ranges={hit.idRanges} />
            {Object.keys(item.params).length > 0 && (
              <span className="text-muted-foreground/70"> {JSON.stringify(item.params)}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 grow items-center gap-1.5">
          <span className="truncate font-medium text-[13.5px]">
            <Highlight text={item.label} ranges={hit.ranges} />
          </span>
          {"state" in item && item.state && (
            <Status tone={item.state === "Scheduled" ? "info" : item.state === "Offline" ? "muted" : "warning"}>{item.state}</Status>
          )}
          {"context" in item && item.context && (
            <span className="truncate text-[11.5px] text-muted-foreground">· {item.context}</span>
          )}
          {item.kind === "page" && <span className="truncate font-mono text-[11px] text-muted-foreground">{item.path}</span>}
        </div>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-2">
        {item.kind === "command" && (
          <>
            {item.unavailable && <span className="text-[11px] text-muted-foreground">{item.unavailable}</span>}
            <EffectTag effect={item.info.effect} />
          </>
        )}
        {(item.kind === "device" || item.kind === "profile") && (
          <span title="Coming soon" className="flex items-center gap-2 opacity-60">
            <span className="text-[11.5px] text-muted-foreground">{item.action}</span>
            <EffectTag effect="write" />
          </span>
        )}
      </div>
    </div>
  );
}
