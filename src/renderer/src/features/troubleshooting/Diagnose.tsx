/**
 * Diagnose a problem: one settings row per symptom with a Diagnose button.
 * It runs `diagnostics.run` (eero's cloud tests, up to a minute); the row
 * says it is testing, then shows eero's findings and the next steps core
 * suggests under it.
 * docs/ux/pages/troubleshooting.md (Diagnose a problem, Actions).
 */
import { CircleCheck, Stethoscope, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, useGate } from "~/components/ui/page";
import { Spinner } from "~/components/ui/spinner";
import { Status } from "~/components/ui/status";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { cn } from "~/lib/utils";
import { resultGood } from "../../../../core/commands/diagnostics";
import type { Diagnosis } from "../../../../core/model";

type Symptom = NonNullable<Diagnosis["symptom"]>;

const SYMPTOMS: { id: Symptom; label: string; detail: string }[] = [
  { id: "connection_drops", label: "My connection drops", detail: "Devices lose Wi-Fi or the internet now and then." },
  { id: "internet_slow", label: "My internet is slow", detail: "Pages load slowly or video stops to buffer." },
  { id: "internet_offline", label: "My internet is offline", detail: "Nothing on the network can reach the internet." },
  { id: "eeros_red", label: "My eero's light is red", detail: "An eero shows a solid red light." },
];

const labelOf = (s: Symptom | null) => SYMPTOMS.find((x) => x.id === s)?.label ?? "Diagnose";

/** One line from eero's answer: the area it points to, else what the results say. */
function summaryOf(r: Diagnosis): string {
  if (r.issueArea) return `eero's diagnostics point to the ${r.issueArea}.`;
  if (r.results.some((x) => !resultGood(x.status))) return "eero's diagnostics found something to check.";
  return r.results.length ? "eero's diagnostics found nothing wrong." : "eero's diagnostics returned no findings.";
}

function Findings({ result }: { result: Diagnosis }) {
  return (
    // Flat in the row, no box of its own, set off like a quote by a 2px bar in the theme's dim colour: eero's answer
    // (in the warning colour, so the fresh result stands out), its results, then the next steps.
    <div className="flex flex-col gap-3 border-muted-foreground/30 border-l-2 py-0.5 ps-3" data-diagnosis={result.symptom ?? "none"}>
      <div className="flex flex-col gap-1">
        <div className="text-muted-foreground text-xs">eero's answer</div>
        <div className="text-sm text-warning-foreground">{summaryOf(result)}</div>
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
        <div className="flex flex-col gap-1">
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

/** The symptom rows, each with Diagnose and, once eero answers, its findings. */
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
  const description = write.running ? `Testing: ${labelOf(asked)}` : last ? `${labelOf(last.symptom)}: ${summaryOf(last).replace(/\.$/, "")}` : "eero tests the network for one symptom, up to a minute";
  return (
    <Section title="Diagnose a problem" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        {SYMPTOMS.map((s) => {
          const testing = write.running && asked === s.id;
          return (
            <SettingsRow
              key={s.id}
              title={
                <>
                  {s.label}
                  {offline && s.id === "internet_offline" && <Status tone="destructive">Network offline</Status>}
                </>
              }
              description={testing ? "eero is testing your network. This can take a minute." : s.detail}
              control={
                <GatedButton gate={gate} variant="outline" className="[&_svg]:text-muted-foreground" disabled={write.running} onClick={() => void run(s.id)}>
                  {testing ? <Spinner className="size-3.5" /> : <Stethoscope />}
                  {testing ? "Testing..." : "Diagnose"}
                </GatedButton>
              }
            >
              {last && !write.running && last.symptom === s.id && <Findings result={last} />}
            </SettingsRow>
          );
        })}
      </Card>
    </Section>
  );
}
