/**
 * Overview: is the network healthy, how fast is it, who is using it, and
 * what changed recently. Layout, data and states: docs/ux/pages/overview.md
 * and docs/mockups/01-overview.html. Every figure comes from a query command;
 * the page only arranges and words it.
 *
 * The small pieces every section shares (row lists, header links, the
 * per-section error note, disabled "Coming soon" buttons) live here too.
 */
import { ArrowRight } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";

import { Link } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button, type ButtonProps } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import { formatRelative } from "../../../../core/format";
import type { Network } from "../../../../core/model";

import { BusyHeatmap } from "./BusyHeatmap";
import { DataUsage } from "./DataUsage";
import { EerosList } from "./EerosList";
import { NetworkHero } from "./NetworkHero";
import { ProfilesList } from "./ProfilesList";
import { RecentActivity } from "./RecentActivity";
import { TopDevices } from "./TopDevices";

export function OverviewView(_props: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged";

  return (
    <>
      <TopBarSubtitle>
        <Freshness at={network.fetchedAt} />
      </TopBarSubtitle>
      {bridged && (
        <Card padded className="text-muted-foreground text-xs">
          {network.data?.name ?? "This network"} is in bridge mode. Profiles and per-device usage need eero to run the
          network (NAT), so they are hidden here.
        </Card>
      )}
      <NetworkHero />
      <DataUsage />
      {bridged ? (
        <div className="grid gap-7 lg:grid-cols-3">
          <EerosList />
          <BusyHeatmap />
          <RecentActivity />
        </div>
      ) : (
        <>
          <div className="grid gap-7 lg:grid-cols-2">
            <EerosList />
            <TopDevices />
          </div>
          <div className="grid gap-7 lg:grid-cols-3">
            <ProfilesList />
            <BusyHeatmap />
            <RecentActivity />
          </div>
        </>
      )}
    </>
  );
}

/** "Updated just now", counting up between polls. */
function Freshness({ at }: { at: number | null }) {
  const now = useNow(15_000);
  if (at === null) return null;
  return <>Updated {formatRelative(new Date(at).toISOString(), now)}</>;
}

/** The current time, refreshed every `everyMs`, for relative times that count up. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Shared pieces

/**
 * A Section whose heading and subtitle share a baseline. Section centres the
 * 14px title and the 12px subtitle on their boxes, which leaves the smaller
 * line sitting about a pixel high; this aligns the header row on baselines
 * and gives the title the row's 28px line so it stays vertically centred
 * (tools such as the Day / Week toggle align on their label's baseline).
 */
export function OverviewSection({ className, ...props }: ComponentProps<typeof Section>) {
  return (
    <Section
      className={cn("[&>div:first-child>h2]:leading-7 [&>div:first-child]:items-baseline", className)}
      {...props}
    />
  );
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
