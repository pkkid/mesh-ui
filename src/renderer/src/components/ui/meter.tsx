// Meter: a thin bar for plan use and utilisation ("412 of 1,000 Mbps",
// "CPU 38%"). The fill is neutral (text colour); from `warnAt` it takes the
// warning status colour and from `dangerAt` the destructive one, since
// colour means status here, never a series (docs/design/design-system.md).
import { cn } from "~/lib/utils";

type MeterProps = {
  /** The current amount; `null` or `undefined` draws an empty track. */
  value: number | null | undefined;
  /** The full scale (plan speed, 100 for percent). */
  max?: number;
  /** Share of `max` (0 to 1) from which the fill shows the warning colour. */
  warnAt?: number;
  /** Share of `max` (0 to 1) from which the fill shows the destructive colour. */
  dangerAt?: number;
  /** What the bar measures, for screen readers ("Download, share of plan"). */
  label: string;
  className?: string;
};

export type MeterTone = "normal" | "warning" | "destructive";

/** The tone for a share of the scale, so callers can colour the figure beside the bar the same way. */
export function meterTone(share: number | null, warnAt?: number, dangerAt?: number): MeterTone {
  if (share === null) return "normal";
  if (dangerAt !== undefined && share >= dangerAt) return "destructive";
  if (warnAt !== undefined && share >= warnAt) return "warning";
  return "normal";
}

const FILL: Record<MeterTone, string> = {
  normal: "bg-foreground/70",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

function Meter({ value, max = 100, warnAt, dangerAt, label, className }: MeterProps) {
  const known = typeof value === "number" && Number.isFinite(value) && max > 0;
  const share = known ? Math.min(1, Math.max(0, value / max)) : null;
  const tone = meterTone(share, warnAt, dangerAt);
  return (
    <div
      data-slot="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={known ? value : undefined}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {share !== null && (
        <div
          className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none", FILL[tone])}
          style={{ width: `${share * 100}%` }}
        />
      )}
    </div>
  );
}

export { Meter };
