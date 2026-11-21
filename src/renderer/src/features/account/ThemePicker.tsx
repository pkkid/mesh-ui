/**
 * Settings, Application theme (docs/ux/pages/settings.md),
 * modelled on T3 Code's theme settings (ThemeSettings.tsx): System / Light /
 * Dark tiles, then a card per theme or collection with a light and a dark
 * circle. Light and dark are picked separately; a collection's circles fan
 * out its styles on hover (Gruvbox Hard, Medium, Soft). Theme choice is
 * renderer view state in localStorage, not a command.
 */
import { Moon, Plus, Sun, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Footnote } from "~/components/ui/page";
import { isBuiltInTheme, groupThemes, removeThemes, useAllThemes } from "~/lib/themeLibrary";
import { getThemeModes, type ThemeAppearance, type ThemeDefinition } from "~/lib/themePalettes";
import {
  type AppearanceMode,
  type ThemeSettings,
  pickThemeEverywhere,
  setThemeSettings,
  themeFor,
  useThemeSettings,
} from "~/lib/themes";
import { cn } from "~/lib/utils";
import { collectionVariantLabels } from "~/lib/vscodeTheme";

import { ThemeImportDialog } from "./ThemeImportDialog";
import { ThemePreviewCircle, ThemeWireframe, previewColors } from "./ThemePreview";
import { ThemeSearch } from "./ThemeSearch";

const MODE_TILES = [
  { mode: "system", label: "System", aria: "Follow the system appearance" },
  { mode: "light", label: "Light", aria: "Use light mode" },
  { mode: "dark", label: "Dark", aria: "Use dark mode" },
] as const;

const MODE_LABEL: Record<ThemeAppearance, string> = { light: "Light", dark: "Dark" };

export function ThemePicker({ id }: { id?: string }) {
  const settings = useThemeSettings();
  const themes = useAllThemes();
  const [importOpen, setImportOpen] = useState(false);
  // The mode tiles take the width of one theme card column, centred above the cards, so they do not stretch
  // across the full-width section. Measured from the cards' grid as it resizes; until then, three equal columns.
  const cardsRef = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    const measure = () => {
      const first = Number.parseFloat(getComputedStyle(el).gridTemplateColumns.split(" ")[0] ?? "");
      setColumn(Number.isFinite(first) && first > 0 ? first : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pane = (mode: ThemeAppearance) => previewColors(themeFor(settings, mode), mode);
  // "Dark mode, Classic", or "System mode, Grove light and Ocean dark": what is picked, from the settings.
  const light = themeFor(settings, "light").label;
  const dark = themeFor(settings, "dark").label;
  const modeWord = MODE_TILES.find((t) => t.mode === settings.mode)?.label ?? "System";
  const description = `${modeWord} mode, ${light === dark ? light : `${light} light and ${dark} dark`}`;

  return (
    <Section
      id={id}
      title="Application theme"
      description={description}
      className="gap-[15px]"
      tools={
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Plus />
          Add theme
        </Button>
      }
    >
      <Card padded className="flex flex-col gap-4">
        <div role="group" aria-label="Appearance mode" className={cn("gap-2", column ? "flex justify-center" : "grid grid-cols-3")}>
          {MODE_TILES.map(({ mode, label, aria }) => {
            const active = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-label={aria}
                aria-pressed={active}
                onClick={() => setThemeSettings({ mode: mode as AppearanceMode })}
                style={column ? { width: column } : undefined}
                className={cn(
                  "flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-7 focus-visible:outline-foreground/60",
                  active
                    ? "border-transparent bg-accent/30 ring-2 ring-inset ring-ring"
                    : "border-border/70 bg-card/60 hover:bg-accent/10",
                )}
              >
                <ThemeWireframe
                  className="h-24"
                  panes={
                    mode === "system"
                      ? [
                          { colors: pane("light"), clip: "left" },
                          { colors: pane("dark"), clip: "right" },
                        ]
                      : [{ colors: pane(mode) }]
                  }
                />
                <span className={cn("text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <div ref={cardsRef} className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 13rem), 1fr))" }}>
          {groupThemes(themes).map((group) => (
            <ThemeCard key={group[0]!.collection?.id ?? group[0]!.id} themes={group} settings={settings} />
          ))}
        </div>
      </Card>
      <Footnote>Pick a light and a dark look. Themes are stored on this computer only.</Footnote>
      <ThemeImportDialog open={importOpen} onOpenChange={setImportOpen}>
        <ThemeSearch onInstalled={() => setImportOpen(false)} />
      </ThemeImportDialog>
    </Section>
  );
}

type Option = { theme: ThemeDefinition; label: string };

/** One theme, or one collection whose styles fan out of each circle. */
function ThemeCard({ themes, settings }: { themes: ReadonlyArray<ThemeDefinition>; settings: ThemeSettings }) {
  const [open, setOpen] = useState<ThemeAppearance | null>(null);
  const first = themes[0]!;
  const isCollection = themes.length > 1;
  const labels = isCollection ? collectionVariantLabels(themes) : [first.label];
  const name = first.collection?.label ?? first.label;
  const custom = !isBuiltInTheme(first.id);

  const groups = (["light", "dark"] as const).flatMap((mode) => {
    const options: Option[] = themes.flatMap((theme, i) =>
      getThemeModes(theme).includes(mode) ? [{ theme, label: labels[i] ?? theme.label }] : [],
    );
    const selected = options.find((o) => o.theme.id === settings[mode]) ?? options[0];
    return selected ? [{ mode, options, selected, active: selected.theme.id === settings[mode] }] : [];
  });
  const lone = groups.length === 1;

  const pickCard = () => {
    if (!isCollection) return pickThemeEverywhere(first);
    const next: Partial<ThemeSettings> = {};
    for (const g of groups) next[g.mode] = g.selected.theme.id;
    setThemeSettings(next);
  };

  return (
    <div
      className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border/70 bg-card/60 transition-colors hover:bg-accent/10"
      onClick={pickCard}
      onMouseLeave={() => setOpen(null)}
    >
      <div
        role="group"
        aria-label={`${name}: light and dark`}
        className="relative h-[5.5rem]"
        onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(null)}
      >
        {groups.map(({ mode, options, selected, active }) => {
          const x = lone ? 0 : mode === "light" ? -40 : 40;
          const fan = options.length > 1;
          const isOpen = open === mode && fan;
          return (
            <div key={mode} className="contents">
              <button
                type="button"
                title={fan ? `${MODE_LABEL[mode]}: ${selected.label}` : `Use for ${mode} mode`}
                aria-label={`Use ${name}${isCollection ? ` ${selected.label}` : ""} for ${mode} mode`}
                aria-pressed={active}
                onClick={(e) => {
                  e.stopPropagation();
                  setThemeSettings({ [mode]: selected.theme.id });
                }}
                onMouseEnter={() => setOpen(mode)}
                onFocus={() => setOpen(mode)}
                className="absolute left-1/2 top-2 z-10 flex size-[60px] cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground/60"
                style={{ transform: `translateX(calc(-50% + ${x}px))` }}
              >
                <ThemePreviewCircle colors={previewColors(selected.theme, mode)} mode={mode} />
                {active && <ActiveMark mode={mode} />}
              </button>
              <span
                className="pointer-events-none absolute bottom-1 left-1/2 inline-flex max-w-24 -translate-x-1/2 items-center gap-1 text-2xs font-medium text-muted-foreground"
                style={{ marginLeft: x }}
              >
                <span className="truncate">{isCollection ? selected.label : MODE_LABEL[mode]}</span>
                {fan && (
                  <span className="shrink-0 rounded-full bg-muted px-1 text-3xs text-muted-foreground">
                    +{options.length - 1}
                  </span>
                )}
              </span>
              {fan &&
                options.map((option, i) => {
                  const progress = i / (options.length - 1) - 0.5;
                  const optionActive = option.theme.id === settings[mode];
                  return (
                    <button
                      key={option.theme.id}
                      type="button"
                      title={`Use ${option.label} for ${mode} mode`}
                      aria-label={`Use ${name} ${option.label} for ${mode} mode`}
                      aria-pressed={optionActive}
                      tabIndex={isOpen ? 0 : -1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setThemeSettings({ [mode]: option.theme.id });
                      }}
                      onMouseEnter={() => setOpen(mode)}
                      onFocus={() => setOpen(mode)}
                      className={cn(
                        "absolute left-1/2 top-1 z-20 flex size-7 cursor-pointer items-center justify-center rounded-full bg-background shadow-sm outline-none transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        optionActive ? "ring-2 ring-inset ring-ring" : "ring-1 ring-border/70",
                      )}
                      style={{
                        opacity: isOpen ? 1 : 0,
                        pointerEvents: isOpen ? "auto" : "none",
                        transform: `translate(calc(-50% + ${isOpen ? x + progress * 64 : x}px), ${isOpen ? Math.abs(progress) * 10 : 28}px) scale(${isOpen ? 1 : 0.55})`,
                        transitionDelay: isOpen ? `${i * 35}ms` : "0ms",
                      }}
                    >
                      <span className="pointer-events-none scale-[0.43]">
                        <ThemePreviewCircle colors={previewColors(option.theme, mode)} mode={mode} />
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div className="flex min-h-9 items-center gap-1 px-3 pb-2 pt-1">
        <button
          type="button"
          aria-label={`Use ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            pickCard();
          }}
          className="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </button>
        {custom && (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            title={isCollection ? "Remove these themes" : "Remove theme"}
            aria-label={`Remove ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              removeThemes(themes.map((t) => t.id));
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

/** The ring and sun or moon badge on the circle in use for a mode. */
function ActiveMark({ mode }: { mode: ThemeAppearance }) {
  const Icon = mode === "light" ? Sun : Moon;
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-0.5 rounded-full ring-2 ring-inset ring-ring" />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm"
      >
        <Icon className="size-3" />
      </span>
    </>
  );
}
