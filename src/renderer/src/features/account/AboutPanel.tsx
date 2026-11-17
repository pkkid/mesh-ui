/**
 * Settings & Account side panel, About (docs/ux/pages/account-settings.md, Side panel 1):
 * logo, version and update status, Check now and Restart to update, the
 * Automatic updates and Beta updates switches, Electron and platform,
 * Network ID, Support ID, links that open in the browser, Show eero
 * request log (`app.log.show`), and the independence line. The updater lives in main (src/main/updater.ts);
 * install kinds that cannot update themselves (deb, rpm, portable, dev) hide
 * the update controls and point at the release page. An unsigned macOS
 * build only checks: a newer version is `available` with a download link.
 */
import { CodeXml, Download, FileText, LifeBuoy, RefreshCw, RotateCw, ScrollText } from "lucide-react";
import type { ReactNode } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { AppIcon } from "~/components/mesh/AppIcon";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { KvList } from "~/components/ui/kv-list";
import { Meter } from "~/components/ui/meter";
import { Status, type StatusTone } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatPercent, formatRelative } from "../../../../core/format";
import type { Account, AppInfo, AppSettings, InstallKind, Network, UpdateStatus } from "../../../../core/model";

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

export function AboutPanel({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const settings = useQuery<AppSettings>("app.settings.get");
  const network = useQuery<Network>("network.get");
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
    <Card padded id={id} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AppIcon className="size-10" />
        <div className="min-w-0">
          <div className="font-medium text-sm">Mesh UI</div>
          <div className={cn("text-muted-foreground text-xs tabular-nums transition-opacity", info.fading && "opacity-40")}>Version {app?.version ?? "-"}</div>
        </div>
      </div>

      {line && (
        <div className="flex flex-col gap-2">
          <Status tone={line.tone} className="whitespace-normal [&>[aria-hidden]]:self-start [&>[aria-hidden]]:mt-[5px]">{line.label}</Status>
          {update?.state === "downloading" && <Meter value={(update.progress ?? 0) * 100} label="Update download" />}
          {update?.state === "available" && (
            <>
              <p className="text-2xs text-muted-foreground">This copy is not signed, so Mesh UI cannot install updates itself. Download the new version and replace the app.</p>
              <ExternalLink href={releaseUrl(update.version)} icon={<Download />}>Download from GitHub</ExternalLink>
            </>
          )}
          {updates ? (
            <div className="flex flex-wrap gap-2">
              {update.state === "ready" && (
                <Button size="xs" disabled={install.running} onClick={() => void install.run({})}>
                  <RotateCw />
                  Restart to update
                </Button>
              )}
              {update.state !== "ready" && (
                <Button size="xs" variant="outline" disabled={busy || check.running} onClick={() => void check.run({})}>
                  <RefreshCw />
                  Check now
                </Button>
              )}
            </div>
          ) : (
            app?.install !== "dev" && <ExternalLink href={RELEASES_URL} icon={<ScrollText />}>Release page</ExternalLink>
          )}
          {error && <div className="text-destructive-foreground text-xs">{error.message}</div>}
        </div>
      )}

      {updates && (
        <div className="flex flex-col gap-2.5">
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

      <KvList
        className="text-xs"
        items={[
          { label: "Electron", value: app ? `${app.electron ?? "-"} · ${OS_NAME[app.os]} ${app.arch}` : null },
          { label: "Network ID", value: network.data?.id ?? null, mono: true, copy: true },
          { label: "Support ID", value: account.data?.id ?? null, mono: true, copy: true },
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <ExternalLink href={RELEASES_URL} icon={<ScrollText />}>Release notes</ExternalLink>
        <ExternalLink href={EERO_SUPPORT_URL} icon={<LifeBuoy />}>eero support articles</ExternalLink>
        <ExternalLink href={SOURCE_URL} icon={<CodeXml />}>Source and issues</ExternalLink>
        {app && app.backend !== "demo" && (
          <button type="button" className={LINK_CLASS} disabled={showLog.running} onClick={() => void showLog.run({})}>
            <FileText />
            Show eero request log
          </button>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">Mesh UI is an independent app and is not made by eero or Amazon.</p>
    </Card>
  );
}

const LINK_CLASS =
  "flex w-fit items-center gap-1.5 rounded-sm text-foreground/80 text-xs outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

/** A link that main opens in the browser (`setWindowOpenHandler`), never in the app. */
function ExternalLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {icon}
      {children}
    </a>
  );
}

/** A label and muted detail with a small on/off switch on the right. */
function SwitchRow({ label, detail, on, disabled, onChange }: { label: string; detail: string; on: boolean | undefined; disabled: boolean; onChange: (on: boolean) => void }) {
  const known = on !== undefined;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs">{label}</div>
        <div className="text-2xs text-muted-foreground">{detail}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={!known || disabled}
        onClick={() => onChange(on !== true)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          on === true ? "border-transparent bg-primary" : "bg-muted",
        )}
      >
        <span className={cn("size-4 rounded-full bg-background shadow-sm transition-transform", on === true ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
