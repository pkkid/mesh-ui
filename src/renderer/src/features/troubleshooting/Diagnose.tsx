/**
 * Diagnose by symptom: the "Something specific?" chips under the health
 * check. A chip runs `diagnostics.run` (eero's cloud tests, up to a minute)
 * and the panel under the chips shows that it is running, then eero's
 * findings and the next steps core suggests.
 * docs/ux/pages/troubleshooting.md (Health check hero, Actions).
 */
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { GatedButton, useGate } from "~/components/ui/page";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { resultGood } from "../../../../core/commands/diagnostics";
import type { Diagnosis } from "../../../../core/model";

type Symptom = NonNullable<Diagnosis["symptom"]>;

const SYMPTOMS: { id: Symptom; label: string }[] = [
  { id: "connection_drops", label: "My connection drops" },
  { id: "internet_slow", label: "My internet is slow" },
  { id: "internet_offline", label: "My internet is offline" },
  { id: "eeros_red", label: "My eero's light is red" },
];

const labelOf = (s: Symptom | null) => SYMPTOMS.find((x) => x.id === s)?.label ?? "Diagnose";

/** One line from eero's answer: the area it points to, else what the results say. */
function summaryOf(r: Diagnosis): string {
  if (r.issueArea) return `eero's diagnostics point to the ${r.issueArea}.`;
  if (r.results.some((x) => !resultGood(x.status))) return "eero's diagnostics found something to check.";
  return r.results.length ? "eero's diagnostics found nothing wrong." : "eero's diagnostics returned no findings.";
}

function Findings({ result, onClose }: { result: Diagnosis; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-(--control-radius) border p-4" data-diagnosis={result.symptom ?? "none"}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{labelOf(result.symptom)}</div>
          <div className="text-muted-foreground text-xs">{summaryOf(result)}</div>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Close diagnostics" onClick={onClose}>
          <X />
        </Button>
      </div>
      {result.results.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {result.results.map((r) => {
            const good = resultGood(r.status);
            const Mark = good ? CircleCheck : TriangleAlert;
            return (
              <li key={r.name} className="flex min-w-0 items-center gap-2 text-xs">
                <Mark className={cn("size-3.5 shrink-0", good ? "text-success-foreground" : "text-warning-foreground")} aria-label={good ? "Good" : "Finding"} />
                <span className="shrink-0 font-medium">{r.name}</span>
                <span className="min-w-0 truncate text-muted-foreground">{r.detail ?? "-"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {result.steps.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-3">
          <div className="text-muted-foreground text-xs">Next steps</div>
          <ol className="list-decimal ps-4 text-xs leading-relaxed">
            {result.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** The symptom chips and the panel with eero's answer. */
export function Diagnose({ offline }: { offline: boolean }) {
  const gate = useGate("diagnostics.run");
  const write = useWrite<{ symptom: Symptom }, Diagnosis>("diagnostics.run", { failure: "Couldn't run diagnostics" });
  const [last, setLast] = useState<Diagnosis | null>(null);
  const [asked, setAsked] = useState<Symptom | null>(null);
  const run = async (symptom: Symptom) => {
    setAsked(symptom);
    setLast(null);
    const r = await write.run({ symptom });
    if (r?.ok) setLast(r.result);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-muted-foreground text-xs">Something specific?</span>
        {SYMPTOMS.map((s) => (
          <GatedButton
            key={s.id}
            gate={gate}
            size="xs"
            variant={(offline && s.id === "internet_offline") || (write.running && asked === s.id) ? "secondary" : "outline"}
            disabled={write.running}
            onClick={() => void run(s.id)}
          >
            {s.label}
          </GatedButton>
        ))}
      </div>
      {write.running && (
        <div className="flex items-center gap-3 rounded-(--control-radius) border p-4 text-xs" role="status">
          <Spinner className="size-4" />
          <div>
            <div className="font-medium text-sm">{labelOf(asked)}</div>
            <div className="text-muted-foreground">eero is testing your network. This can take a minute.</div>
          </div>
        </div>
      )}
      {last && !write.running && <Findings result={last} onClose={() => setLast(null)} />}
    </div>
  );
}

