/**
 * Account & Settings, Command line and agents (docs/ux/pages/account-settings.md,
 * Layout 5; docs/mockups/17-account-settings.html).
 *
 * Left: the Command line and MCP server lines to copy, or **Install CLI**
 * (`app.cli.install`) when this install kind can put `mesh-ui` on PATH and
 * has not, and the PATH line when the launcher's folder is not on PATH.
 * Right: this week's CLI and agent commands from the audit log
 * (`app.audit.list`): a count, a sparkline per day and the latest ids.
 * Header: "MCP used <age>" or "MCP not used yet".
 */
import { Check, Copy, ShieldCheck, Terminal } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { Sparkline } from "~/components/charts/Sparkline";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Status } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { seriesColors } from "~/lib/chartColors";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { AppInfo, AuditList, CliStatus } from "../../../../core/model";

const CLI_EXAMPLE = "mesh-ui run device.list";
const MCP_EXAMPLE = "claude mcp add mesh-ui -- mesh-ui mcp";
/** Latest commands listed beside the sparkline. */
const SHOWN = 5;

/** One line of shell to copy: a `$` prompt, the text, a copy button. */
function CodeLine({ text, label, prompt = true }: { text: string; label: string; prompt?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text, { toast: false })) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else toast.error("Couldn't copy", { detail: "The clipboard refused the text." });
  };
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 ps-3 pe-1 font-mono text-xs">
      {prompt && <span className="select-none text-muted-foreground">$</span>}
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      <Button variant="ghost-muted" size="icon-xs" aria-label={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="font-medium text-xs">{label}</div>
      {children}
    </div>
  );
}

/** Install CLI (or Reinstall) where Mesh UI can put the launcher on PATH itself. */
function InstallCli({ cli }: { cli: CliStatus }) {
  const install = useCommand<Record<string, never>, CliStatus>("app.cli.install");
  const run = async () => {
    const res = await install.run({});
    if (!res.ok) toast.error("Couldn't install the command line tool", { detail: res.error.message });
    else if (res.result.installed && !res.result.reinstall) toast.success(res.result.onPath ? "mesh-ui is on PATH" : "Installed mesh-ui");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Terminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-foreground">{cli.reinstall ? "The command line tool points at an old copy" : "Use Mesh UI from a terminal"}</div>
          <div className="mt-0.5 text-muted-foreground">
            {cli.reinstall ? "Mesh UI moved since the mesh-ui command was installed." : "Puts the mesh-ui command on your PATH for scripts and AI agents."}
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={install.running} onClick={() => void run()}>
          {cli.reinstall ? "Reinstall" : "Install CLI"}
        </Button>
      </div>
      {cli.pathLine && (!cli.installed || cli.reinstall) && (
        <Labelled label="Or add it to PATH yourself">
          <CodeLine text={cli.pathLine} label="the PATH line" prompt={false} />
        </Labelled>
      )}
    </div>
  );
}

function CommandLines({ cli }: { cli: CliStatus | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Labelled label="Command line">
        <CodeLine text={CLI_EXAMPLE} label="the command line example" />
      </Labelled>
      <Labelled label="MCP server">
        <CodeLine text={MCP_EXAMPLE} label="the MCP server command" />
      </Labelled>
      {cli?.installed && cli.pathLine && (
        <Labelled label="Not on PATH yet">
          <p className="text-muted-foreground text-xs" title={cli.path ?? undefined}>
            mesh-ui is installed, but its folder is not on your PATH. Add this line to your shell profile:
          </p>
          <CodeLine text={cli.pathLine} label="the PATH line" prompt={false} />
        </Labelled>
      )}
    </div>
  );
}

function ThisWeek({ audit, now }: { audit: AuditList | undefined; now: number }) {
  const total = audit?.weekTotal ?? 0;
  const loading = audit === undefined;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">This week</span>
        <span className="text-muted-foreground tabular-nums">
          {loading ? "-" : total === 0 ? "No commands yet" : `${total.toLocaleString("en-US")} ${total === 1 ? "command" : "commands"} from the CLI and agents`}
        </span>
      </div>
      <Sparkline
        values={audit?.week.map((d) => d.count) ?? [0, 0, 0, 0, 0, 0, 0]}
        color={seriesColors.neutral}
        ariaLabel={`CLI and agent commands per day this week: ${audit?.week.map((d) => d.count).join(", ") ?? "loading"}`}
        loading={loading}
        className="h-8"
      />
      {audit && audit.entries.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-2 text-xs">
          {audit.entries.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.at}-${e.id}-${i}`} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-mono" title={`${e.id} (${e.surface === "mcp" ? "MCP" : "CLI"})`}>
                {e.id}
              </span>
              {e.code === "needs_confirm" && <span className="shrink-0 text-warning-foreground">needs confirm</span>}
              <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">{formatRelative(e.at, now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        !loading && <p className="mt-1 text-muted-foreground text-xs">Commands run with mesh-ui or by an AI agent show here.</p>
      )}
    </div>
  );
}

export function CliAgents({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const audit = useQuery<AuditList>("app.audit.list", undefined, { poll: true });
  const now = audit.fetchedAt ?? Date.now();
  const cli = info.data?.cli ?? null;
  const mcpLast = audit.data?.mcpLastAt ?? null;
  const offerInstall = cli !== null && cli.canInstall && (!cli.installed || cli.reinstall);

  return (
    <Section
      id={id}
      title="Command line and agents"
      subtitle="Everything in this window is also a command"
      tools={
        audit.data &&
        (mcpLast ? <Status tone="success">MCP used {formatRelative(mcpLast, now)}</Status> : <Status tone="muted">MCP not used yet</Status>)
      }
    >
      <Card padded className="flex flex-col gap-5">
        <div className={cn("grid items-start gap-7 md:grid-cols-2", audit.loading && !audit.data && "opacity-40")}>
          {offerInstall ? <InstallCli cli={cli} /> : <CommandLines cli={cli} />}
          <ThisWeek audit={audit.data} now={now} />
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          <span>
            Agents never see your session token. Commands that restart eeros or can't be undone only run with <span className="font-mono">--confirm</span>.
          </span>
        </div>
      </Card>
    </Section>
  );
}
