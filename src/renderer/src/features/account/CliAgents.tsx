/**
 * Settings, Command line and agents (docs/ux/pages/settings.md,
 * Layout 5; docs/mockups/17-account-settings.html).
 *
 * Settings rows in one card. First the access levels for the command line
 * and MCP agents (`app.access.set`, saved in settings.json and checked by the
 * engine: Off, Read only, Changes, Full access; see
 * docs/architecture/security.md#access-levels), then one taller row with
 * the hookup and this week's commands. A surface that is off shows no
 * hookup lines; with both off the row is only this week's list.
 *
 * Left: the Command line and Add MCP server lines to copy, or **Install CLI**
 * (`app.cli.install`) when this install kind can put `mesh-ui` on PATH and
 * has not, and the PATH line when the launcher's folder is not on PATH.
 * Right: this week's CLI and agent commands from the audit log
 * (`app.audit.list`): a count, a sparkline per day and the latest 100
 * commands in a scrolling list, each with where it ran (CLI or MCP).
 * Subtitle from the data: this week's command count and when an agent last
 * used MCP ("12 commands this week, MCP used 5m ago"). The safety line is a
 * footnote under the card.
 */
import { Check, Copy, Terminal } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { Sparkline } from "~/components/charts/Sparkline";
import { Button } from "~/components/ui/button";
import { useWrite } from "~/app/useWrite";
import { ChoiceSelect, Group, Row } from "~/features/advanced/SettingsGroups";
import { toast } from "~/components/ui/toast";
import { seriesColors } from "~/lib/chartColors";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { AccessLevel, AppInfo, AppSettings, AuditList, CliStatus } from "../../../../core/model";

const CLI_EXAMPLE = "mesh-ui run device.list";
/** The command that adds the MCP server, for each agent CLI. */
const MCP_ADD = [
  { agent: "Claude Code", text: "claude mcp add mesh-ui -- mesh-ui mcp" },
  { agent: "Codex", text: "codex mcp add mesh-ui -- mesh-ui mcp" },
  { agent: "Antigravity", text: "agy mcp add mesh-ui mesh-ui mcp" },
];
/** The levels, least to most; the row's description says what the chosen one allows. */
const ACCESS_OPTIONS: ReadonlyArray<{ value: AccessLevel; label: string }> = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read only" },
  { value: "changes", label: "Changes" },
  { value: "full", label: "Full access" },
];
const ACCESS_DETAIL: Record<AccessLevel, string> = {
  off: "Every command is refused.",
  read: "Can look at the network, but not change it or see Wi-Fi passwords.",
  changes: "Can look and make changes, such as pausing a device or restarting an eero, but never delete or hand over anything.",
  full: "Can run every command, including ones that cannot be undone, such as removing an eero.",
};
const ACCESS_SURFACE = {
  cli: { title: "Command line", lead: "The mesh-ui command in a terminal or script.", setting: "cliAccess" },
  mcp: { title: "MCP server", lead: "AI agents connected with mesh-ui mcp.", setting: "mcpAccess" },
} as const;

/** Latest commands listed beside the sparkline, in a list that scrolls past about eight. */
const SHOWN = 100;

/** One line of shell to copy: a `$` prompt, the text, a copy button. Muted, as the command palette shows code. */
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
      {prompt && <span className="select-none text-muted-foreground/70">$</span>}
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={text}>
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

/** The hookup lines to copy; a surface that is off has none. */
function CommandLines({ cli, showCli, showMcp }: { cli: CliStatus | null; showCli: boolean; showMcp: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {showCli && (
        <Labelled label="Run a command">
          <CodeLine text={CLI_EXAMPLE} label="the command line example" />
        </Labelled>
      )}
      {showMcp && (
        <Labelled label="Add MCP server">
          {MCP_ADD.map((m) => (
            <CodeLine key={m.agent} text={m.text} label={`the ${m.agent} MCP command`} />
          ))}
        </Labelled>
      )}
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
        <ul className="scroll-fade-y mt-1 flex max-h-52 flex-col gap-2 overflow-y-auto pe-2 text-xs">
          {audit.entries.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.at}-${e.id}-${i}`} className="flex items-baseline gap-2">
              {/* Where it ran: a short column first, so the ids line up after it. */}
              <span className="w-8 shrink-0 text-muted-foreground" title={e.surface === "mcp" ? "Run by an AI agent over MCP" : "Run from the command line"}>
                {e.surface === "mcp" ? "MCP" : "CLI"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={e.id}>
                {e.id}
              </span>
              {e.code === "needs_confirm" && <span className="shrink-0 text-warning-foreground">needs confirm</span>}
              {e.code === "access_denied" && <span className="shrink-0 text-warning-foreground">blocked</span>}
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

/** One access row: the level for the command line or for MCP agents. */
function AccessRow({ surface, settings }: { surface: keyof typeof ACCESS_SURFACE; settings: AppSettings | undefined }) {
  const { title, lead, setting } = ACCESS_SURFACE[surface];
  const write = useWrite<{ cli?: AccessLevel; mcp?: AccessLevel }, AppSettings>("app.access.set", { failure: `Couldn't change ${title.toLowerCase()} access` });
  const level = settings?.[setting];
  const choose = (next: AccessLevel) => {
    if (!level || next === level) return;
    const label = ACCESS_OPTIONS.find((o) => o.value === next)?.label ?? next;
    void write.run({ [surface]: next }, { success: `${title}: ${label}`, undo: { id: "app.access.set", params: { [surface]: level } } });
  };
  return (
    <Row
      title={title}
      description={level ? `${lead} ${ACCESS_DETAIL[level]}` : lead}
      control={<ChoiceSelect<AccessLevel> aria-label={`${title} access`} value={(level ?? "") as AccessLevel} onValueChange={choose} options={ACCESS_OPTIONS} />}
    />
  );
}

export function CliAgents({ id }: { id?: string }) {
  const info = useQuery<AppInfo>("app.info", undefined, { poll: true });
  const audit = useQuery<AuditList>("app.audit.list", { limit: SHOWN }, { poll: true });
  const settings = useQuery<AppSettings>("app.settings.get");
  const now = audit.fetchedAt ?? Date.now();
  const cli = info.data?.cli ?? null;
  const mcpLast = audit.data?.mcpLastAt ?? null;
  // A surface that is off shows no hookup; with both off the row is only this week's list.
  const showCli = settings.data?.cliAccess !== "off";
  const showMcp = settings.data?.mcpAccess !== "off";
  const hookup = showCli || showMcp;
  const offerInstall = hookup && cli !== null && cli.canInstall && (!cli.installed || cli.reinstall);
  const week = audit.data?.weekTotal ?? 0;
  const description = !audit.data
    ? "-"
    : [week ? `${week.toLocaleString("en-US")} ${week === 1 ? "command" : "commands"} this week` : "No commands this week", mcpLast ? `MCP used ${formatRelative(mcpLast, now)}` : "MCP not used yet"].join(", ");

  return (
    <Group
      id={id}
      title="Command line and agents"
      description={description}
      note={
        <>
          Everything in this window is also a command. Agents never see your session token, can never change their own access, and commands that restart eeros or can't be undone only run with{" "}
          <span className="font-mono">--confirm</span>.
        </>
      }
    >
      <AccessRow surface="cli" settings={settings.data} />
      <AccessRow surface="mcp" settings={settings.data} />
      <div className={cn("grid items-start gap-7 px-4 py-4", hookup && "md:grid-cols-2", audit.loading && !audit.data && "opacity-40")}>
        {offerInstall ? <InstallCli cli={cli} /> : hookup && <CommandLines cli={cli} showCli={showCli} showMcp={showMcp} />}
        <ThisWeek audit={audit.data} now={now} />
      </div>
    </Group>
  );
}
