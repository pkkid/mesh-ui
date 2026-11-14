/**
 * "Network actions": Restart network, disruptive, with the engine's confirm
 * inline. Also home to the restart watcher every restart control shares
 * (eeros page, Overview hero, eero detail): a progress toast that stays
 * until the eeros that restarted are back. docs/ux/pages/eeros.md (Layout 3,
 * Actions).
 */
import { RotateCcw } from "lucide-react";

import { execute, invalidate, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Section } from "~/components/ui/card";
import { WriteConfirm } from "~/components/ui/confirm";
import { IconTile } from "~/components/ui/hero";
import { GatedButton, Row, RowList, useGate } from "~/components/ui/page";
import { toast } from "~/components/ui/toast";
import type { RestartResult } from "../../../../core/commands/network";
import type { Eero, Network } from "../../../../core/model";

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

/** Restart network with an inline confirm, then the watcher. Used by the eeros page and the Overview hero. */
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

export function NetworkActions() {
  const restart = useRestartNetwork();
  return (
    <Section title="Network actions">
      <RowList>
        <Row>
          <IconTile icon={RotateCcw} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[13.5px]">Restart network</div>
            <div className="text-muted-foreground text-xs">Restarts every eero at once. Disruptive: everyone loses internet for 2 to 3 minutes.</div>
          </div>
          {!restart.write.asking && (
            <GatedButton gate={restart.gate} size="xs" variant="outline" disabled={restart.write.running} onClick={() => void restart.run()}>
              Restart
            </GatedButton>
          )}
        </Row>
        {restart.write.asking && (
          <div className="px-4 pb-3">
            <WriteConfirm write={restart.write}>{null}</WriteConfirm>
          </div>
        )}
      </RowList>
    </Section>
  );
}
