/**
 * Settings, Application settings (docs/ux/pages/settings.md, Layout 2): four
 * settings rows (four switches and a color menu) in one card, as on Advanced networking. Keep running in the
 * tray comes first, because what Start at login does depends on it; the
 * update switches follow.
 *
 * - **Keep running in the tray** (`app.settings.set {runInTray}`): closing
 *   the window hides it to the tray so desktop alerts keep arriving
 *   (src/main/tray.ts). On a Linux desktop with no tray it can only be
 *   turned off.
 * - **Start at login** (`app.startup.set`): the OS login item, read back
 *   from the OS through `app.info.startup`, so a change made in system
 *   settings shows here too. A development build cannot register one.
 * - **Automatic updates** (`app.settings.set {autoUpdate}`) and **Beta
 *   updates** (`app.settings.set {updateChannel}`): the updater in
 *   src/main/updater.ts. Install kinds that cannot update themselves (deb,
 *   rpm, portable, dev) show both switches disabled, as Start at login does.
 *
 * - **Download and upload colors**: blue and purple, or green and red
 *   (lib/trafficColors.ts); view state saved on this computer, no command.
 *
 * With both on, a login launch always starts hidden in the tray; with the
 * tray off it opens the window, and Start at login's description says which.
 */
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Group, Row, WriteSwitch } from "~/features/advanced/SettingsGroups";
import { hue } from "~/lib/chartColors";
import { setTrafficColors, TRAFFIC_COLOR_OPTIONS, type TrafficColors, useTrafficColors } from "~/lib/trafficColors";
import type { AppInfo, AppSettings, StartupStatus } from "../../../../core/model";
import { applicationSummary, startAtLoginDetail } from "./startupCopy";

const ALLOWED = { allowed: true, reason: null };
const NO_UPDATES = { allowed: false, reason: "This copy of Mesh UI does not update itself" };

export function ApplicationSettings({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const settings = useQuery<AppSettings>("app.settings.get");
  const startupWrite = useWrite<{ enabled: boolean }, StartupStatus>("app.startup.set", { failure: "Couldn't change start at login" });
  const trayWrite = useWrite<{ runInTray: boolean }, AppSettings>("app.settings.set", { failure: "Couldn't change keep running in the tray" });
  const autoWrite = useWrite<{ autoUpdate: boolean }, AppSettings>("app.settings.set", { failure: "Couldn't change automatic updates" });
  const betaWrite = useWrite<{ updateChannel: AppSettings["updateChannel"] }, AppSettings>("app.settings.set", { failure: "Couldn't change beta updates" });

  const startup = info.data?.startup ?? undefined;
  const tray = info.data?.tray;
  const inTray = settings.data?.runInTray;
  const noTray = tray === false;
  const update = info.data?.update;
  const updates = update === undefined ? undefined : update.state !== "unsupported";
  const autoUpdate = settings.data?.autoUpdate;
  const trafficColors = useTrafficColors();
  const beta = settings.data ? settings.data.updateChannel === "beta" : undefined;

  return (
    <Group
      id={id}
      title="Application settings"
      description={applicationSummary(startup?.supported ? startup.enabled : startup ? false : undefined, inTray, updates === false ? null : autoUpdate, beta)}
    >
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
      <Row
        title="Automatic updates"
        description={
          updates === false
            ? "This copy of Mesh UI does not update itself. Get new versions from the release page or your package manager."
            : "Check for new versions at launch and every 6 hours, and download them in the background."
        }
        control={
          <WriteSwitch
            on={updates === false ? false : autoUpdate}
            label="Automatic updates"
            gate={updates === false ? NO_UPDATES : ALLOWED}
            busy={autoWrite.running}
            onToggle={(next) =>
              void autoWrite.run(
                { autoUpdate: next },
                { success: next ? "Mesh UI will check for updates" : "Automatic updates are off", undo: { id: "app.settings.set", params: { autoUpdate: !next } } },
              )
            }
          />
        }
      />
      <Row
        title="Beta updates"
        description="Also get pre-releases, to try new features before they are released."
        control={
          <WriteSwitch
            on={updates === false ? false : beta}
            label="Beta updates"
            gate={updates === false ? NO_UPDATES : ALLOWED}
            busy={betaWrite.running}
            onToggle={(next) =>
              void betaWrite.run(
                { updateChannel: next ? "beta" : "latest" },
                { success: next ? "Mesh UI will get beta updates" : "Mesh UI will get releases only", undo: { id: "app.settings.set", params: { updateChannel: next ? "latest" : "beta" } } },
              )
            }
          />
        }
      />
      <Row
        title="Download and upload colors"
        description="The colors for download and upload in every chart, legend and rate. Saved on this computer."
        control={
          <Select items={TRAFFIC_COLOR_OPTIONS} value={trafficColors} onValueChange={(v) => v && setTrafficColors(v as TrafficColors)}>
            <SelectTrigger size="tool" aria-label="Download and upload colors">
              <SelectValue>{(v: TrafficColors) => <TrafficOption value={v} />}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {TRAFFIC_COLOR_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <TrafficOption value={o.value} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </Group>
  );
}

/** A colors choice: a dot for download and one for upload, in that choice's hues, then its name. */
function TrafficOption({ value }: { value: TrafficColors }) {
  const o = TRAFFIC_COLOR_OPTIONS.find((x) => x.value === value) ?? TRAFFIC_COLOR_OPTIONS[0];
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex gap-1">
        <span className="size-2 rounded-full" style={{ backgroundColor: hue(o.download) }} />
        <span className="size-2 rounded-full" style={{ backgroundColor: hue(o.upload) }} />
      </span>
      {o.label}
    </span>
  );
}
