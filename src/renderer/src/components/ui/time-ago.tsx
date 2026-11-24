/**
 * A relative time ("16h ago", "Nov 3") whose tooltip gives the exact time in
 * the network's time zone ("Tue, Oct 20, 2026, 9:41:07 AM EDT"). Use it
 * wherever a relative time is shown as text, so the precise time is a hover
 * away (docs/design/design-system.md, Relative times).
 */
import { formatRelative, networkClock } from "../../../../core/format";

export function TimeAgo({ at, now, timeZone, className }: { at: string | null | undefined; now: number; timeZone?: string | null; className?: string }) {
  const text = formatRelative(at, now, timeZone ?? "UTC");
  if (!at) return <span className={className}>{text}</span>;
  return (
    <time dateTime={at} title={networkClock(timeZone).full(at)} className={className}>
      {text}
    </time>
  );
}
