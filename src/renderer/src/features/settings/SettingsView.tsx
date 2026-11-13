import { Check, KeyRound, LogOut, Monitor, Moon, Sun, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { SessionStorage } from "@shared/types";

import { Button } from "~/components/ui/button";
import { TopBar } from "~/features/shell/TopBar";
import { type AppearanceMode, resolveAppearance, setThemeSettings, themes, useThemeSettings } from "~/lib/themes";
import { getThemeColorsForAppearance } from "~/lib/themePalettes";
import { cn } from "~/lib/utils";

const MODES: { id: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export function SettingsView({ onSignOut }: { onSignOut: () => void }) {
  const settings = useThemeSettings();
  const appearance = resolveAppearance(settings.mode);
  const [storage, setStorage] = useState<SessionStorage | null>(null);

  useEffect(() => {
    void window.mesh.sessionStorage().then(setStorage);
  }, []);

  return (
    <>
      <TopBar title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-8">
          <Section title="Appearance">
            <Row label="Mode" description="Follow the system or pick light or dark.">
              <div className="flex rounded-lg border bg-muted p-0.5">
                {MODES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemeSettings({ mode: id })}
                    data-active={settings.mode === id || undefined}
                    className="flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-muted-foreground text-xs transition-colors hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-xs/5"
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </Row>
            <div className="flex flex-col gap-3 p-4">
              <div>
                <div className="font-medium text-sm">Theme</div>
                <div className="text-muted-foreground text-xs">Palettes from T3 Code.</div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                {themes.map((theme) => {
                  const c = getThemeColorsForAppearance(theme, appearance);
                  const selected = theme.id === settings.themeId;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setThemeSettings({ themeId: theme.id })}
                      className={cn(
                        "group cursor-pointer overflow-hidden rounded-lg border text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "ring-2 ring-ring",
                      )}
                    >
                      <div className="flex h-14" style={{ background: c.canvas }}>
                        <div className="w-1/3 border-e" style={{ background: c.sidebar, borderColor: c.sidebarBorder }} />
                        <div className="flex flex-1 flex-col justify-end gap-1 p-2">
                          <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.textMuted, opacity: 0.4 }} />
                          <div className="h-2.5 w-8 rounded-sm" style={{ background: c.messageAction }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between border-t bg-card px-2 py-1.5 text-xs">
                        {theme.label}
                        {selected && <Check className="size-3.5 text-foreground" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section title="Account">
            {storage && (
              <Row
                label="Saved session"
                description={
                  storage === "keychain"
                    ? "Encrypted with your system keychain and kept between launches."
                    : "No system keychain found, so the session is kept in memory and you'll sign in each launch."
                }
              >
                {storage === "keychain" ? (
                  <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs">
                    <KeyRound className="size-3.5" />
                    Keychain
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-warning-foreground text-xs">
                    <TriangleAlert className="size-3.5" />
                    Memory only
                  </span>
                )}
              </Row>
            )}
            <Row label="Sign out" description="End the eero session and remove it from this computer.">
              <Button variant="outline" size="sm" onClick={onSignOut}>
                <LogOut />
                Sign out
              </Button>
            </Row>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 font-medium text-muted-foreground text-xs">{title}</h2>
      <div className="divide-y rounded-xl border bg-card">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div>
        <div className="font-medium text-sm">{label}</div>
        {description && <div className="text-muted-foreground text-xs">{description}</div>}
      </div>
      {children}
    </div>
  );
}
