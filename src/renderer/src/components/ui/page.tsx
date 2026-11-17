/**
 * Small pieces every page shares: row lists, header links, the per-section
 * error note, disabled "Coming soon" buttons, write gating (`useGate`,
 * `GatedButton`) and a ticking clock for relative times. Moved here from the
 * Overview page (M2.2) so every M2 page reuses them.
 */
import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Link } from "~/app/router";
import { useCommands, useQuery } from "~/app/useCommand";
import { type Gate, type GateOptions, gateFor } from "~/app/useWrite";
import { Button, type ButtonProps } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { commandUnavailable } from "~/features/palette/search";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import type { Network, Permissions } from "../../../../core/model";

/** The current time, refreshed every `everyMs`, for relative times that count up. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** An outline button in a section header that goes to another page ("Topology →"); `Section` sets its size. */
export function HeaderLink({ to, children, arrow = false }: { to: string; children: ReactNode; arrow?: boolean }) {
  return (
    <Button variant="outline" render={<Link to={to} />}>
      {children}
      {arrow && <ArrowRight />}
    </Button>
  );
}

/** A button for an action whose write command lands in a later milestone: disabled, with a tooltip. */
export function ComingSoonButton({ title = "Coming soon", ...props }: ButtonProps & { title?: string }) {
  return (
    <span title={title} className="inline-flex">
      <Button {...props} disabled />
    </span>
  );
}

/**
 * Whether a write control can be used, from network.permissions and
 * network.get (docs/ux/overview.md#permission-gating, #capability-gating,
 * #bridge-mode). Allowed while they load: the engine is still the gate.
 *
 * Pass the command id (`useGate("device.pause")`) to use the gate its spec
 * declares, the same rule and reason the palette shows. Options are the
 * older form, kept until each page moves to ids.
 */
export function useGate(command: string | GateOptions): Gate {
  const commands = useCommands();
  const byId = typeof command === "string";
  const info = byId ? commands?.find((c) => c.id === command) : undefined;
  const opts: GateOptions = byId ? { area: info?.gate?.area ?? undefined, capability: info?.gate?.capability ?? undefined, bridgeOff: info?.gate?.bridgeOff } : command;
  const permissions = useQuery<Permissions>("network.permissions", undefined, { enabled: byId || opts.area !== undefined });
  // Destructive commands also read the role from network.get (owner-only rule).
  const network = useQuery<Network>("network.get", undefined, { enabled: opts.capability !== undefined || opts.bridgeOff === true || info?.effect === "destructive" });
  if (byId) {
    const reason = info ? commandUnavailable(info, permissions.data, network.data) : null;
    return { allowed: reason === null, reason };
  }
  return gateFor(opts, permissions.data, network.data);
}

/** A write button that dims with a tooltip saying why when its gate is closed. */
export function GatedButton({ gate, title, ...props }: ButtonProps & { gate: Gate; title?: string }) {
  if (gate.allowed) return <Button title={title} {...props} />;
  return (
    <span title={gate.reason ?? undefined} className="inline-flex">
      <Button {...props} disabled />
    </span>
  );
}

/** The card a list of rows sits in (eeros, profiles, activity). */
export function RowList({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn("divide-y divide-border/50", className)}>{children}</Card>;
}

const ROW = "flex min-h-[58px] items-center gap-3.5 px-4 py-3";

/** One row in a RowList; a link when `to` is given. */
export function Row({ to, className, children }: { to?: string; className?: string; children: ReactNode }) {
  if (!to) return <div className={cn(ROW, className)}>{children}</div>;
  return (
    <Link to={to} className={cn(ROW, "outline-none hover:bg-muted/50 focus-visible:bg-muted/50", className)}>
      {children}
    </Link>
  );
}

/** Blank rows at normal height while a list loads. */
export function PlaceholderRows({ count }: { count: number }) {
  return (
    <RowList>
      {Array.from({ length: count }, (_, i) => (
        <Row key={i}>
          <span />
        </Row>
      ))}
    </RowList>
  );
}

/**
 * The per-section error note: what failed, eero's message, and Retry. Other
 * sections keep working. `not_signed_in` never reaches here (the app shows
 * sign-in).
 */
export function SectionError({ what, error, onRetry }: { what: string; error: ExecuteError; onRetry: () => void }) {
  return (
    <Card>
      <Empty className="flex flex-col items-center gap-3">
        <span>
          Couldn't load {what}. {error.message}
        </span>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </Empty>
    </Card>
  );
}
