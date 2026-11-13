/**
 * Small pieces every page shares: row lists, header links, the per-section
 * error note, disabled "Coming soon" buttons and a ticking clock for relative
 * times. Moved here from the Overview page (M2.2) so every M2 page reuses them.
 */
import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Link } from "~/app/router";
import { Button, type ButtonProps } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";

/** The current time, refreshed every `everyMs`, for relative times that count up. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** A small outline button in a section header that goes to another page ("Topology →"). */
export function HeaderLink({ to, children, arrow = false }: { to: string; children: ReactNode; arrow?: boolean }) {
  return (
    <Button size="xs" variant="outline" render={<Link to={to} />}>
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

/** The card a list of rows sits in (eeros, profiles, activity). */
export function RowList({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn("divide-y", className)}>{children}</Card>;
}

const ROW = "flex min-h-[58px] items-center gap-3.5 px-[18px] py-[13px]";

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
