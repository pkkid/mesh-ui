/**
 * eero's coverage scan and placement test pieces (docs/ux/pages/signal.md),
 * shared by the Signal page's Mesh section and the eeros page's weak-link
 * note: link quality as 5 cells, a placement rating, and the placement test
 * (`eero.placement.test`) with its gate. The coverage scan is a `/2.4/` read;
 * a 404 hides its parts (`unsupported`).
 */
import { useState } from "react";

import type { QueryState } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { GatedButton, useGate } from "~/components/ui/page";
import { signalQualityColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { MISSING } from "../../../../core/format";
import type { Eero, PlacementResult, SignalQuality } from "../../../../core/model";

type Rating = NonNullable<PlacementResult["rating"]>;

/**
 * eero's four ratings, in the Signal page's signal quality colours (strong as
 * excellent, poor as weak), so coverage cells, placement ratings and device
 * dots read on one scale.
 */
export const RATING: Record<Rating, { label: string; quality: SignalQuality }> = {
  poor: { label: "Poor", quality: "weak" },
  fair: { label: "Fair", quality: "fair" },
  good: { label: "Good", quality: "good" },
  strong: { label: "Strong", quality: "excellent" },
};

/** 0 to 100 to 1 to 5 cells and a rating word. */
const cellsOf = (q: number) => Math.max(1, Math.min(5, Math.ceil(q / 20)));
const ratingOf = (q: number): Rating => (q >= 80 ? "strong" : q >= 60 ? "good" : q >= 40 ? "fair" : "poor");

/** The 2.4 API is missing on this network: hide the section. */
export const unsupported = (q: Pick<QueryState<unknown>, "error">) => q.error?.code === "eero_error" && q.error.detail?.status === 404;


export function QualityCells({ quality }: { quality: number | null }) {
  if (quality === null) return <span className="text-muted-foreground">{MISSING}</span>;
  const n = cellsOf(quality);
  const rating = RATING[ratingOf(quality)];
  const fill = signalQualityColors[rating.quality];
  // What the cells mean lives in their tooltip, so the section's subtitle can just say when the scan ran.
  const what = `Coverage ${quality} of 100, ${rating.label.toLowerCase()}: how well the devices on this eero connect, from eero's coverage scan`;
  return (
    <span className="inline-flex gap-0.5 align-middle" role="img" aria-label={what} title={what}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("h-3 w-2 rounded-[2px]", i >= n && "bg-muted")} style={i < n ? { background: fill } : undefined} />
      ))}
    </span>
  );
}

/** A placement rating as a dot in its quality colour and word, eero's advice as its tooltip. Shared with the eeros page's weak-link note. */
export function PlacementRating({ result }: { result: PlacementResult }) {
  const r = result.rating ? RATING[result.rating] : null;
  return (
    <span title={result.advice ?? undefined} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-xs", r ? "text-foreground/80" : "text-muted-foreground")}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: r ? signalQualityColors[r.quality] : "var(--color-muted-foreground)" }} />
      {r?.label ?? "No rating"}
    </span>
  );
}

/**
 * `eero.placement.test` through the write kit, with the gate, the eero being
 * tested and each eero's last result. Shared by the coverage table and the
 * eeros page's weak-link note.
 */
export function usePlacementTest() {
  const gate = useGate("eero.placement.test");
  const placement = useWrite<{ eero: string }, PlacementResult>("eero.placement.test", { failure: "Couldn't test placement" });
  const [results, setResults] = useState<Record<string, PlacementResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const test = async (id: string) => {
    setTesting(id);
    const r = await placement.run({ eero: id });
    setTesting(null);
    if (r?.ok) setResults((t) => ({ ...t, [id]: r.result }));
  };
  return { gate, results, testing, test };
}

export function PlacementCell({ eero, result, testing, onTest, gate }: { eero: Eero | undefined; result: PlacementResult | undefined; testing: boolean; onTest: () => void; gate: ReturnType<typeof useGate> }) {
  if (testing) return <span className="text-muted-foreground text-xs">Testing...</span>;
  if (result) return <PlacementRating result={result} />;
  if (!eero || eero.isGateway) return null;
  return (
    <GatedButton gate={eero.status === "offline" ? { allowed: false, reason: `${eero.location} is offline` } : gate} size="xs" variant="ghost-muted" onClick={onTest}>
      Test
    </GatedButton>
  );
}
