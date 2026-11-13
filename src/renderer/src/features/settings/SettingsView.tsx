/**
 * Placeholder for App & account until its page is built (M6). The prototype
 * settings view is retired; only Appearance stays, so themes can still be
 * picked: a card per theme with preview orbs, and Light / Dark / System.
 * Theme choice is renderer view state in localStorage, not a command.
 */
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { routeById, type PageProps } from "~/app/routes";
import { Card, Section } from "~/components/ui/card";
import { Segmented } from "~/components/ui/segmented";
import { ComingSoon } from "~/features/shell/ComingSoon";
import { type AppearanceMode, setThemeSettings, themes, useResolvedAppearance, useThemeSettings } from "~/lib/themes";
import { getSeriesForAppearance, getThemeColorsForAppearance } from "~/lib/themePalettes";
import { cn } from "~/lib/utils";

const MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function AccountPlaceholder({ params }: PageProps) {
  return (
    <ComingSoon route={routeById("account")} params={params}>
      <AppearanceSettings />
    </ComingSoon>
  );
}

export function AppearanceSettings() {
  const settings = useThemeSettings();
  const appearance = useResolvedAppearance();

  return (
    <Section
      title="Appearance"
      subtitle="Stored on this computer only"
      tools={
        <Segmented<AppearanceMode>
          aria-label="Appearance"
          value={settings.mode}
          onValueChange={(mode) => setThemeSettings({ mode })}
          options={MODES}
        />
      }
    >
      <Card padded>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3" role="radiogroup" aria-label="Theme">
          {themes.map((theme) => {
            const c = getThemeColorsForAppearance(theme, appearance);
            const series = getSeriesForAppearance(theme, appearance);
            const selected = theme.id === settings.themeId;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setThemeSettings({ themeId: theme.id })}
                className={cn(
                  "cursor-pointer overflow-hidden rounded-[10px] border text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-muted-foreground/70",
                )}
              >
                <div className="flex h-16" style={{ background: c.canvas }}>
                  <div className="w-1/3 border-e" style={{ background: c.sidebar, borderColor: c.sidebarBorder }} />
                  <div className="flex flex-1 flex-col justify-between p-2">
                    <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.textMuted, opacity: 0.45 }} />
                    <div className="flex gap-1">
                      {(["blue", "purple", "aqua", "orange"] as const).map((h) => (
                        <span key={h} className="size-2.5 rounded-full" style={{ background: series[h] }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t bg-card px-2.5 py-1.5 text-xs">
                  {theme.label}
                  {selected && <Check className="size-3.5" />}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}
