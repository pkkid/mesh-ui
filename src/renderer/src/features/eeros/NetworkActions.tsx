/**
 * "Network actions": Restart network, disruptive, with the engine's confirm
 * in the app's confirm dialog, with the row (`useRestartNetworkRow`) shared with
 * Troubleshooting and Advanced. Also home to the restart watcher every restart control shares
 * (eeros page, Overview hero, eero detail): a progress toast that stays
 * until the eeros that restarted are back. docs/ux/pages/eeros.md (Layout 3,
 * Actions).
 */
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { execute, invalidate, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, useGate } from "~/components/ui/page";
import { toast } from "~/components/ui/toast";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { restartNetworkLine } from "~/features/eero/helpers";
import type { RestartResult } from "../../../../core/commands/network";
import { formatCount } from "../../../../core/format";
import type { Eero, Network, SettingsImpact } from "../../../../core/model";

/** First check, while eero still reports the restart. */
const FIRST_LOOK_MS = 1_000;
/** How often the watcher reads eero.list (the engine cache answers most of these). */
const WATCH_EVERY_MS = 5_000;
/** If no restarted eero is seen down by then, eero restarted faster than a read could tell: done. */
const SEE_DOWN_MS = 90_000;
/** Past this the toast turns into an error pointing at the eeros page. */
const GIVE_UP_MS = 10 * 60_000;

const isDown = (e: Pick<Eero, "status">) => e.status === "updating" || e.status === "offline";

/**
 * Shows "Restarting <what>" with the estimate until every eero in the
 * result is back: seen down and then up again (or never seen down within
 * 90 s). A failed read counts as down, since restarting the gateway takes
 * this computer offline too. Refreshes the eero and network queries on each
 * check, so pages show Updating and then Online without waiting for their
 * 60 s poll.
 */
export function watchRestart(result: RestartResult, what: string): void {
  const id = toast.progress(`Restarting ${what}`, { detail: `Back in ${result.estimate}` });
  if (result.eeroIds.length === 0) {
    toast.update(id, "success", { title: `Restart sent to ${what}` });
    return;
  }
  const ids = new Set(result.eeroIds);
  const started = Date.now();
  let seenDown = false;
  const tick = async () => {
    // Read the restarted network, even if another one is selected meanwhile.
    const r = await execute<Eero[]>("eero.list", { networkId: result.networkId });
    const elapsed = Date.now() - started;
    invalidate(["eero.", "network."]);
    if (!r.ok) seenDown = true;
    // A restarted eero missing from the list is not back yet.
    else if (r.result.filter((e) => ids.has(e.id) && !isDown(e)).length < ids.size) seenDown = true;
    else if (seenDown || elapsed > SEE_DOWN_MS) {
      toast.update(id, "success", { title: `${what} is back` });
      return;
    }
    if (elapsed > GIVE_UP_MS) {
      toast.update(id, "error", { title: `${what} is taking longer than expected`, detail: "Check the eeros page; eero may still be restarting." });
      return;
    }
    setTimeout(() => void tick(), WATCH_EVERY_MS);
  };
  // The first look comes soon, so a quick restart (the demo's 5 s) is seen going down.
  setTimeout(() => void tick(), FIRST_LOOK_MS);
}

/** Restart network with the confirm dialog, then the watcher. Used by the eeros page and the Overview hero. */
export function useRestartNetwork() {
  const network = useQuery<Network>("network.get");
  const write = useWrite<Record<string, never>, RestartResult>("network.restart", {
    confirm: { title: "Restart network?", confirmLabel: "Yes, restart network" },
  });
  const gate = useGate({ area: "network" });
  const name = network.data?.name ?? "the network";
  const offline = network.data?.status === "offline";
  const run = async () => {
    const r = await write.run({});
    if (r?.ok) watchRestart(r.result, name);
  };
  return { write, run, gate: offline ? { allowed: false, reason: `${name} is offline` } : gate };
}

/**
 * The Restart network row's description and button, the same on the eeros
 * page, Troubleshooting and Advanced (Danger zone): one sentence from
 * `settings.impact` and `restartNetworkLine`, and a neutral outline button
 * with a dim icon. Red text is for actions that do not undo themselves
 * (design-system.md, Confirmation); the confirm dialog carries the warning.
 * Each page writes `<SettingsRow title="Restart network" {...row} />` itself,
 * so the search palette's Places index it on that page (scripts/places.ts
 * reads titles per file).
 */
export function useRestartNetworkRow(): { description: string; control: ReactNode } {
  const restart = useRestartNetwork();
  const impact = useQuery<SettingsImpact>("settings.impact", { changes: [{ id: "network.restart" }] });
  return {
    description: restartNetworkLine(impact.data),
    control: (
      // Ellipsis: it confirms first.
      <GatedButton gate={restart.gate} variant="outline" className="[&_svg]:text-muted-foreground" disabled={restart.write.running} onClick={() => void restart.run()}>
        <RotateCcw />
        Restart network{"\u2026"}
      </GatedButton>
    ),
  };
}

export function NetworkActions({ eeros }: { eeros: ReadonlyArray<Eero> | undefined }) {
  const restart = useRestartNetworkRow();
  const n = eeros?.length ?? 0;
  return (
    <Section title="Network actions" description={eeros ? `${formatCount(n)} ${n === 1 ? "eero" : "eeros"}` : "-"} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <SettingsRow title="Restart network" {...restart} />
      </Card>
    </Section>
  );
}
