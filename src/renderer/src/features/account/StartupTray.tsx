/**
 * Settings, Startup and tray (docs/ux/pages/settings.md, Layout 2): two
 * settings rows in one card, as on Advanced networking.
 *
 * - **Start at login** (`app.startup.set`): the OS login item, read back
 *   from the OS through `app.info.startup`, so a change made in system
 *   settings shows here too. A development build cannot register one.
 * - **Keep running in the tray** (`app.settings.set {runInTray}`): closing
 *   the window hides it to the tray so desktop alerts keep arriving
 *   (src/main/tray.ts). On a Linux desktop with no tray it can only be
 *   turned off.
 *
 * With both on, a login launch starts in the tray without opening the window.
 */
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Group, Row, WriteSwitch } from "~/features/advanced/SettingsGroups";
import type { AppInfo, AppSettings, StartupStatus } from "../../../../core/model";

const ALLOWED = { allowed: true, reason: null };

/** The section's description from the two settings: what happens at login and when the window closes. */
export function startupSummary(startAtLogin: boolean | undefined, inTray: boolean | undefined): string {
  if (startAtLogin === undefined || inTray === undefined) return "How Mesh UI starts and stops on this computer.";
  const login = startAtLogin ? (inTray ? "Starts in the tray at login" : "Opens at login") : "Opens only when you start it";
  return `${login}. ${inTray ? "Closing the window keeps it running in the tray." : "Closing the window quits it."}`;
}

export function StartupTray({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const settings = useQuery<AppSettings>("app.settings.get");
  const startupWrite = useWrite<{ enabled: boolean }, StartupStatus>("app.startup.set", { failure: "Couldn't change start at login" });
  const trayWrite = useWrite<{ runInTray: boolean }, AppSettings>("app.settings.set", { failure: "Couldn't change keep running in the tray" });

  const startup = info.data?.startup ?? undefined;
  const tray = info.data?.tray;
  const inTray = settings.data?.runInTray;
  const noTray = tray === false;

  return (
    <Group id={id} title="Startup and tray" description={startupSummary(startup?.supported ? startup.enabled : startup ? false : undefined, inTray)}>
      <Row
        title="Start at login"
        description={
          startup && !startup.supported
            ? "Open Mesh UI when you sign in to this computer. Not available in a development build."
            : "Open Mesh UI when you sign in to this computer. With Keep running in the tray on, it starts in the tray without opening the window."
        }
        control={
          <WriteSwitch
            on={startup ? startup.supported && startup.enabled : undefined}
            label="Start at login"
            gate={startup && !startup.supported ? { allowed: false, reason: "Only in an installed copy of Mesh UI" } : ALLOWED}
            busy={startupWrite.running}
            onToggle={(enabled) =>
              void startupWrite.run(
                { enabled },
                { success: enabled ? "Mesh UI will open at login" : "Mesh UI won't open at login", undo: { id: "app.startup.set", params: { enabled: !enabled } } },
              )
            }
          />
        }
      />
      <Row
        title="Keep running in the tray"
        description={
          noTray
            ? "This desktop shows no tray icons, so closing the window quits Mesh UI. On GNOME, add the AppIndicator extension."
            : "Closing the window keeps Mesh UI running in the system tray (the menu bar on macOS), so desktop alerts keep arriving. Quit from the tray icon."
        }
        control={
          <WriteSwitch
            on={inTray}
            label="Keep running in the tray"
            // With no tray it can only be turned off, never on.
            gate={noTray && inTray !== true ? { allowed: false, reason: "This desktop shows no tray icons" } : ALLOWED}
            busy={trayWrite.running}
            onToggle={(runInTray) =>
              void trayWrite.run(
                { runInTray },
                { success: runInTray ? "Mesh UI will keep running in the tray" : "Closing the window quits Mesh UI", undo: { id: "app.settings.set", params: { runInTray: !runInTray } } },
              )
            }
          />
        }
      />
    </Group>
  );
}
