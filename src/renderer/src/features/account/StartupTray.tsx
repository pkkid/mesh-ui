/**
 * Settings, Startup and tray (docs/ux/pages/settings.md, Layout 2): two
 * settings rows in one card, as on Advanced networking. Keep running in the
 * tray comes first, because what Start at login does depends on it.
 *
 * - **Start at login** (`app.startup.set`): the OS login item, read back
 *   from the OS through `app.info.startup`, so a change made in system
 *   settings shows here too. A development build cannot register one.
 * - **Keep running in the tray** (`app.settings.set {runInTray}`): closing
 *   the window hides it to the tray so desktop alerts keep arriving
 *   (src/main/tray.ts). On a Linux desktop with no tray it can only be
 *   turned off.
 *
 * With both on, a login launch always starts hidden in the tray; with the
 * tray off it opens the window, and Start at login's description says which.
 */
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Group, Row, WriteSwitch } from "~/features/advanced/SettingsGroups";
import type { AppInfo, AppSettings, StartupStatus } from "../../../../core/model";
import { startAtLoginDetail, startupSummary } from "./startupCopy";

const ALLOWED = { allowed: true, reason: null };

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
      <Row
        title="Start at login"
        description={startAtLoginDetail(startup?.supported, inTray === true && !noTray)}
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
    </Group>
  );
}
