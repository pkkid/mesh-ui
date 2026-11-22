/**
 * The last crumb on a detail page (device, eero, profile) as a switcher
 * (docs/design/design-system.md#topbar-crumbs): the name is a button, as T3
 * Code's thread title, with a chevron that fades in on hover or focus. It
 * opens a searchable list of the page's siblings in the list page's order;
 * picking one opens it. Longer lists get a filter field that ranks matches as
 * the command palette does (`siblingHits` in palette/search.ts). Up and Down
 * move the highlight, Enter opens, Esc closes.
 */
import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { navigate } from "~/app/router";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { networkStatus, Status, StatusDot, type StatusTone } from "~/components/ui/status";
import { Highlight } from "~/features/palette/PaletteResults";
import { type SiblingHit, type SiblingItem, siblingHits } from "~/features/palette/search";
import { deviceIcon, eeroIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";

import { TopBarTitle } from "./TopBar";

/** Lists longer than this get the filter field. */
export const SWITCHER_FILTER_THRESHOLD = 10;

type Kind = SiblingItem["kind"];
const NOUN: Record<Kind, string> = { device: "devices", eero: "eeros", profile: "profiles" };

export type TitleSwitcherProps = {
  /** The crumb text ("Basement eero"). */
  title: string;
  kind: Kind;
  /** Every sibling, in the list page's order. */
  items: ReadonlyArray<SiblingItem>;
  currentId: string;
  /** The page to open for an item. */
  pathFor: (id: string) => string;
};

/** Fills the last crumb with the switcher. */
export function TopBarTitleSwitcher(props: TitleSwitcherProps) {
  return (
    <TopBarTitle>
      <TitleSwitcher {...props} />
    </TopBarTitle>
  );
}

function TitleSwitcher({ title, kind, items, currentId, pathFor }: TitleSwitcherProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${title}: switch to another ${kind}`}
        className="group/title no-drag inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-start focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100 group-data-popup-open/title:opacity-100"
        />
      </PopoverTrigger>
      {open && (
        <SwitcherPopup
          kind={kind}
          items={items}
          currentId={currentId}
          onPick={(id) => {
            setOpen(false);
            if (id !== currentId) navigate(pathFor(id));
          }}
        />
      )}
    </Popover>
  );
}

function SwitcherPopup({ kind, items, currentId, onPick }: { kind: Kind; items: ReadonlyArray<SiblingItem>; currentId: string; onPick: (id: string) => void }) {
  const searchable = items.length > SWITCHER_FILTER_THRESHOLD;
  const [query, setQuery] = useState("");
  const hits = useMemo(() => siblingHits(query, kind, items), [query, kind, items]);
  const currentAt = hits.findIndex((h) => h.item.id === currentId);
  const [highlight, setHighlight] = useState(Math.max(currentAt, 0));
  const at = Math.min(highlight, hits.length - 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted row (the current item on open) in view.
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length > 0) setHighlight(Math.max(0, Math.min(hits.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" && !searchable) {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End" && !searchable) {
      e.preventDefault();
      setHighlight(hits.length - 1);
    } else if (e.key === "Enter") {
      const hit = hits[at];
      if (!hit) return;
      e.preventDefault();
      onPick(hit.item.id);
    }
  };

  const optionId = (i: number) => `title-switcher-${i}`;
  return (
    <PopoverPopup initialFocus={searchable ? inputRef : listRef} className="w-[340px] max-h-[min(60vh,var(--available-height))]" onKeyDown={onKeyDown}>
      {searchable && (
        <div className="border-border/60 border-b p-1.5">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded
            aria-controls="title-switcher-list"
            aria-activedescendant={hits[at] ? optionId(at) : undefined}
            aria-label={`Find ${NOUN[kind]}`}
            placeholder={`Find ${kind === "eero" ? "an eero" : `a ${kind}`}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            className="h-7 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      )}
      <div
        ref={listRef}
        id="title-switcher-list"
        role="listbox"
        tabIndex={-1}
        aria-label={`Other ${NOUN[kind]}`}
        aria-activedescendant={!searchable && hits[at] ? optionId(at) : undefined}
        className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
      >
        {hits.length === 0 && <div className="px-2.5 py-1.5 text-muted-foreground">No {NOUN[kind]} match.</div>}
        {hits.map((hit, i) => (
          <div
            key={hit.item.key}
            id={optionId(i)}
            data-index={i}
            role="option"
            aria-selected={hit.item.id === currentId}
            data-highlighted={i === at ? "" : undefined}
            onMouseMove={() => i !== at && setHighlight(i)}
            onClick={() => onPick(hit.item.id)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 data-highlighted:bg-muted/60"
          >
            <Check aria-hidden className={cn("size-3.5 shrink-0", hit.item.id !== currentId && "invisible")} />
            <Row hit={hit} />
          </div>
        ))}
      </div>
    </PopoverPopup>
  );
}

const DEVICE_TONE: Record<string, StatusTone> = { Blocked: "destructive", Paused: "warning", Offline: "muted" };

/** Icon, name (matches highlighted) and muted context on the right. */
function Row({ hit }: { hit: SiblingHit }) {
  const { item } = hit;
  const name = (
    <span className="min-w-0 flex-1 truncate text-foreground">
      <Highlight text={item.label} ranges={hit.ranges} />
    </span>
  );
  if (item.kind === "device") {
    const Icon = deviceIcon(item.device);
    const state = item.state ?? "Online";
    return (
      <>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {name}
        {item.context && <span className="max-w-[45%] shrink truncate text-muted-foreground">{item.context}</span>}
        <span title={state} className="flex shrink-0 items-center">
          <StatusDot tone={DEVICE_TONE[state] ?? "success"} />
          <span className="sr-only">{state}</span>
        </span>
      </>
    );
  }
  if (item.kind === "eero") {
    const Icon = eeroIcon(item.eero);
    const s = networkStatus(item.eero.status);
    return (
      <>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {name}
        <Status tone={s.tone} className="shrink-0 font-normal">
          {s.label}
        </Status>
      </>
    );
  }
  return (
    <>
      {name}
      {item.state && <span className="shrink-0 text-muted-foreground">{item.state}</span>}
    </>
  );
}
