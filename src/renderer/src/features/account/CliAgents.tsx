/**
 * App & account, Command line and agents (docs/ux/pages/app-account.md,
 * Layout 5). Skeleton from M6.1; M6.6 adds the CLI and MCP lines, Install
 * CLI and the week's commands from `app.audit.list`.
 */
import { Card, Section } from "~/components/ui/card";

export function CliAgents({ id }: { id?: string }) {
  return (
    <Section id={id} title="Command line and agents" subtitle="Everything in this window is also a command">
      <Card padded className="text-muted-foreground text-xs">
        Run Mesh UI from a terminal or an AI agent.
      </Card>
    </Section>
  );
}
