/**
 * Settings hero (docs/ux/pages/settings.md, Layout 1): the flat page header
 * with this copy of Mesh UI front and centre. The app icon, "Mesh UI 0.6.0",
 * the update status, then Electron, Platform, Release notes and Source and
 * issues stacked in one format (icon, then "Label value" or the link),
 * then Check for updates or Restart to update and the Automatic updates and
 * Beta updates switches. On the right, "eero details" in the same format: the
 * Support ID (with a copy icon), eero support articles and Show eero request
 * log.
 * It was the About side panel until 2026-11-21. The updater lives in main (src/main/updater.ts);
 * install kinds that cannot update themselves (deb, rpm, portable, dev) hide
 * the update controls and point at the release page. An unsigned macOS
 * build only checks: a newer version is `available` with a download link.
 */
import { Atom, Check, CodeXml, Copy, Download, FileText, IdCard, LifeBuoy, Monitor, RefreshCw, RotateCw, ScrollText } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { AppIcon } from "~/components/mesh/AppIcon";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/hero";
import { Meter } from "~/components/ui/meter";
import { Status, type StatusTone } from "~/components/ui/status";
import { Switch } from "~/components/ui/switch";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatPercent, formatRelative } from "../../../../core/format";
import type { Account, AppInfo, AppSettings, InstallKind, UpdateStatus } from "../../../../core/model";

export const RELEASES_URL = "https://github.com/pkkid/mesh-ui/releases";
const SOURCE_URL = "https://github.com/pkkid/mesh-ui";
const EERO_SUPPORT_URL = "https://support.eero.com/hc/en-us";

const OS_NAME: Record<AppInfo["os"], string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Why this copy does not update itself, for install kinds that report `unsupported`. */
function unsupportedLine(install: InstallKind): string {
  if (install === "deb" || install === "rpm") return "Installed with a package manager. Update with apt or dnf.";
  if (install === "portable") return "Portable copy. Download new versions from the release page.";
  return "Development build. Updates are off.";
}

/** The status dot and words for an update state. */
export function updateStatusLine(u: UpdateStatus, install: InstallKind, now: number): { tone: StatusTone; label: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const checked = u.checkedAt ? `checked ${formatRelative(u.checkedAt, now, tz)}` : null;
  switch (u.state) {
    case "idle":
      return checked ? { tone: "success", label: `Up to date · ${checked}` } : { tone: "muted", label: "Not checked yet" };
    case "off":
      return { tone: "muted", label: checked ? `Automatic updates off · ${checked}` : "Automatic updates off" };
    case "checking":
      return { tone: "muted", label: "Checking for updates" };
    case "available":
      return { tone: "info", label: `Version ${u.version ?? "-"} is available` };
    case "downloading":
      return { tone: "info", label: `Downloading ${u.version ?? "update"} · ${formatPercent((u.progress ?? 0) * 100)}` };
    case "ready":
      return { tone: "info", label: `Version ${u.version ?? "-"} is ready` };
    case "error":
      return { tone: "warning", label: u.error ?? "Update check failed." };
    case "unsupported":
      return { tone: "muted", label: unsupportedLine(install) };
  }
}

/** The GitHub release page for a version (tags are `v<version>`), else the releases list. */
export function releaseUrl(version: string | null): string {
  return version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}

const DIM_ICON = "[&_svg]:text-muted-foreground";

export function SettingsHero({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const settings = useQuery<AppSettings>("app.settings.get");
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const check = useCommand<Record<string, never>, UpdateStatus>("app.update.check");
  const install = useCommand("app.update.install");
  const setSettings = useCommand<Partial<AppSettings>, AppSettings>("app.settings.set");
  const showLog = useCommand("app.log.show");

  const app = info.data;
  const update = app?.update;
  const updates = update !== undefined && update.state !== "unsupported";
  const busy = update?.state === "checking" || update?.state === "downloading";
  const line = app && update ? updateStatusLine(update, app.install, Date.now()) : null;
  const error = check.error ?? install.error ?? setSettings.error ?? showLog.error;

  return (
    <PageHeader
      flat
      id={id}
      data-slot="settings-hero"
      className={cn("transition-opacity", info.fading && !app && "opacity-40")}
      icon={<AppIcon className="size-16" />}
      title={<span className="tabular-nums">Mesh UI {app?.version ?? ""}</span>}
      status={
        line ? (
          <>
            <Status tone={line.tone}>{line.label}</Status>
            {error && <span className="text-destructive-foreground">{error.message}</span>}
            {/* Its own line under the update status, in that line's colour but not bold. */}
            <span className={cn("basis-full", line.tone === "muted" ? "text-muted-foreground" : "text-foreground/80")}>
              Mesh UI is an independent app and is not made by eero or Amazon.
            </span>
          </>
        ) : null
      }
      facts={
        // One format for every line: its icon, then the words ("Electron 45.3.1") or the link, stacked.
        <div className="flex flex-col gap-1.5">
          <InfoLine icon={<Atom />} label="Electron" value={app ? (app.electron ?? "-") : null} />
          <InfoLine icon={<Monitor />} label="Platform" value={app ? `${OS_NAME[app.os]} ${app.arch}` : null} />
          <ExternalLink href={RELEASES_URL} icon={<ScrollText />}>
            Release notes
          </ExternalLink>
          <ExternalLink href={SOURCE_URL} icon={<CodeXml />}>
            Source and issues
          </ExternalLink>
        </div>
      }
      actions={
        // Only where this copy updates itself (or can download a new version); a dev or package build has no buttons.
        (updates || update?.state === "available") && (
          <div className="flex flex-col gap-4">
            {update?.state === "downloading" && <Meter value={(update.progress ?? 0) * 100} label="Update download" className="w-64" />}
            {update?.state === "available" && (
              <p className="max-w-md text-muted-foreground text-xs">This copy is not signed, so Mesh UI cannot install updates itself. Download the new version and replace the app.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {update?.state === "ready" && (
                <Button variant="outline" className={DIM_ICON} disabled={install.running} onClick={() => void install.run({})}>
                  <RotateCw />
                  Restart to update
                </Button>
              )}
              {update?.state === "available" && (
                <Button variant="outline" className={DIM_ICON} render={<a href={releaseUrl(update.version)} target="_blank" rel="noreferrer" />}>
                  <Download />
                  Download from GitHub
                </Button>
              )}
              {updates && update.state !== "ready" && (
                <Button variant="outline" className={DIM_ICON} disabled={busy || check.running} onClick={() => void check.run({})}>
                  <RefreshCw className={cn(busy && "animate-spin motion-reduce:animate-none")} />
                  Check for updates
                </Button>
              )}
            </div>
            {/* The update switches sit with the update buttons, under the details. */}
            {updates && (
              <div className="flex w-72 flex-col gap-3">
                <SwitchRow
                  label="Automatic updates"
                  detail="Check at launch and every 6 hours"
                  on={settings.data?.autoUpdate}
                  disabled={setSettings.running}
                  onChange={(autoUpdate) => void setSettings.run({ autoUpdate })}
                />
                <SwitchRow
                  label="Beta updates"
                  detail="Also get pre-releases"
                  on={settings.data ? settings.data.updateChannel === "beta" : undefined}
                  disabled={setSettings.running}
                  onChange={(beta) => void setSettings.run({ updateChannel: beta ? "beta" : "latest" })}
                />
              </div>
            )}
          </div>
        )
      }
      aside={
        // eero details: what belongs to the eero side, not this copy of Mesh UI, under a title like Signal's Signal spread.
        <div data-slot="eero-details" className="flex w-64 flex-col gap-2">
          <h2 className="font-semibold text-base text-foreground leading-7">eero details</h2>
          <div className="flex flex-col gap-1.5">
            <InfoLine icon={<IdCard />} label="Support ID" value={account.data?.id ?? null} mono copy />
            <ExternalLink href={EERO_SUPPORT_URL} icon={<LifeBuoy />}>
              eero support articles
            </ExternalLink>
            {app && app.backend !== "demo" && (
              <button type="button" className={LINK_CLASS} disabled={showLog.running} onClick={() => void showLog.run({})}>
                <FileText />
                Show eero request log
              </button>
            )}
          </div>
        </div>
      }
    />
  );
}

const LINK_CLASS =
  "flex min-h-5 w-fit items-center gap-1.5 rounded-sm text-foreground/80 text-xs outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

/** A link that main opens in the browser (`setWindowOpenHandler`), never in the app: its icon, then the words. */
function ExternalLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {icon}
      {children}
    </a>
  );
}

/** A detail in the links' format: its icon, then "Label value" in one colour; an optional copy icon after it. */
function InfoLine({ icon, label, value, mono = false, copy = false }: { icon: ReactNode; label: string; value: string | null; mono?: boolean; copy?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className="flex min-h-5 items-center gap-1.5 text-foreground/80 text-xs [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
      {icon}
      {/* "Electron 45.3.1": label and value in one colour, one space apart. */}
      <span>
        {label} <span className={cn("tabular-nums", mono && "font-mono")}>{value ?? "-"}</span>
      </span>
      {copy && value && (
        <button
          type="button"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={() => void copyText(value).then(setDone)}
          className="cursor-pointer rounded-sm p-0.5 outline-none transition-colors hover:[&_svg]:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {done ? <Check /> : <Copy />}
        </button>
      )}
    </div>
  );
}

/** A label and muted detail with a small on/off switch on the right. */
function SwitchRow({ label, detail, on, disabled, onChange }: { label: string; detail: string; on: boolean | undefined; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[13px]">{label}</div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </div>
      <Switch checked={on} aria-label={label} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
