/**
 * The plan sheet: the download and upload speed you pay for, and an
 * optional name. `internet.plan.set` stores it in Mesh UI's settings (no eero
 * call); gauges, meters and verdicts compare against it. Opened from the
 * Internet hero's plan line and the Overview hero's "Set your plan";
 * `openPlanSheet()` opens whichever `<PlanSheet />` the page renders.
 * docs/ux/pages/internet.md (Actions: Plan value).
 */
import { Gauge } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useQuery } from "~/app/useCommand";
import { fieldErrors, useWrite, type WriteRequest } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { formatMbps } from "../../../../core/format";
import type { Internet, Network, PlanSpeed } from "../../../../core/model";

let open = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  open = next;
  listeners.forEach((l) => l());
};

/** Opens the plan sheet on the current page. */
export const openPlanSheet = (): void => setOpen(true);

const MAX_MBPS = 100_000;
const NAME_MAX = 40;

/** A speed field's text to Mbps, or an error to show under it. */
function parseMbps(text: string, dir: "download" | "upload"): { value: number | null; error?: string } {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return { value: null, error: `Enter the ${dir} speed.` };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { value: null, error: `The ${dir} speed must be more than 0 Mbps.` };
  if (n > MAX_MBPS) return { value: null, error: `The ${dir} speed is ${MAX_MBPS.toLocaleString("en-US")} Mbps at most.` };
  return { value: n };
}

const planText = (p: PlanSpeed) => `${formatMbps(p.down)} down, ${formatMbps(p.up)} up`;

/** What Undo runs: the plan before the change, or clearing it. */
const restore = (previous: PlanSpeed | null): WriteRequest =>
  previous ? { id: "internet.plan.set", params: { ...previous } } : { id: "internet.plan.set", params: { clear: true } };

export function PlanSheet() {
  const isOpen = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
  // One sheet at a time: the page that rendered it closes it when it unmounts.
  useEffect(() => () => setOpen(false), []);
  if (!isOpen) return null;
  return <PlanForm onClose={() => setOpen(false)} />;
}

function PlanForm({ onClose }: { onClose: () => void }) {
  const network = useQuery<Network>("network.get");
  const internet = useQuery<Internet>("internet.get");
  const plan = internet.data?.planMbps ?? null;
  const write = useWrite<{ down?: number; up?: number; label?: string; clear?: true }, PlanSpeed | null>("internet.plan.set", {
    failure: "Couldn't save the plan",
  });

  const [down, setDown] = useState(plan ? String(plan.down) : "");
  const [up, setUp] = useState(plan ? String(plan.up) : "");
  const [label, setLabel] = useState(plan?.label ?? "");
  const [touched, setTouched] = useState(false);
  const [removing, setRemoving] = useState(false);

  const d = parseMbps(down, "download");
  const u = parseMbps(up, "upload");
  const name = label.trim();
  const local = { down: d.error, up: u.error, label: name.length > NAME_MAX ? `The plan name is ${NAME_MAX} characters at most.` : undefined };
  const server = fieldErrors(write.error);
  const errors = {
    down: server.down ?? (touched ? local.down : undefined),
    up: server.up ?? (touched ? local.up : undefined),
    label: server.label ?? local.label,
  };
  const valid = !local.down && !local.up && !local.label;
  const dirty = !plan || d.value !== plan.down || u.value !== plan.up || name !== (plan.label ?? "");

  const save = () =>
    write.run(
      { down: d.value ?? undefined, up: u.value ?? undefined, ...(name ? { label: name } : {}) },
      {
        form: true,
        success: (p) => (p ? `Plan set to ${planText(p)}` : "Plan saved"),
        undo: restore(plan),
      },
    );

  const remove = async () => {
    const r = await write.run({ clear: true }, { success: "Plan removed", undo: restore(plan) });
    if (r?.ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<Gauge />}
      title="Internet plan"
      subtitle={`${network.data?.name ?? "This network"} · gauges and speed test verdicts compare against it. Saved in Mesh UI, not on eero.`}
      dirty={dirty}
      valid={valid}
      onSave={save}
      error={server._form}
      footerStart={
        plan &&
        (removing ? (
          <span className="flex items-center gap-2">
            <span className="text-foreground/80 text-xs">Remove the plan?</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(false)}>
              Keep
            </Button>
            <Button type="button" size="sm" variant="destructive" disabled={write.running} onClick={() => void remove()}>
              Remove
            </Button>
          </span>
        ) : (
          <Button type="button" size="sm" variant="ghost" className="text-destructive-foreground" onClick={() => setRemoving(true)}>
            Remove plan
          </Button>
        ))
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <SheetField label="Download (Mbps)" htmlFor="plan-down" error={errors.down} helper={d.value ? formatMbps(d.value) : "1 Gbps is 1,000 Mbps"}>
          <Input
            id="plan-down"
            inputMode="decimal"
            autoFocus
            className="tabular-nums"
            value={down}
            placeholder="1000"
            aria-invalid={errors.down ? true : undefined}
            onBlur={() => setTouched(true)}
            onChange={(e) => setDown(e.target.value)}
          />
        </SheetField>
        <SheetField label="Upload (Mbps)" htmlFor="plan-up" error={errors.up} helper={u.value ? formatMbps(u.value) : undefined}>
          <Input
            id="plan-up"
            inputMode="decimal"
            className="tabular-nums"
            value={up}
            placeholder="1000"
            aria-invalid={errors.up ? true : undefined}
            onBlur={() => setTouched(true)}
            onChange={(e) => setUp(e.target.value)}
          />
        </SheetField>
      </div>
      <SheetField label="Plan name (optional)" htmlFor="plan-label" error={errors.label} helper={`${name.length} / ${NAME_MAX}`}>
        <Input id="plan-label" value={label} placeholder="Fiber Gig" aria-invalid={errors.label ? true : undefined} onChange={(e) => setLabel(e.target.value)} />
      </SheetField>
    </Sheet>
  );
}
