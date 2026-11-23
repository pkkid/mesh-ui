/**
 * eero detail: `useEeroRestart`, the hero's Restart eero… (`eero.restart`,
 * disruptive: the engine's confirm in the confirm dialog, naming the gateway
 * outage or the eeros downstream, then a progress toast until they are back),
 * and `RemoveEeroRow`, the last row of "eero settings" (`eero.remove`,
 * destructive: the confirm dialog with type-the-name, then back to eeros). The
 * gateway is offered only when it is the only eero, as core refuses it
 * otherwise. docs/ux/pages/eero-detail.md (Layout 5, Actions, States).
 */
import { navigate, pathFor } from "~/app/router";
import { useWrite } from "~/app/useWrite";
import { GatedButton, useGate } from "~/components/ui/page";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { watchRestart } from "~/features/eeros/NetworkActions";
import type { RestartResult } from "../../../../core/commands/network";
import type { Eero } from "../../../../core/model";
import { restartLine } from "./helpers";

/** Restart for one eero, with the gate the hero button uses (closed while offline or restarting). */
export function useEeroRestart(eero: Eero | null, eeros: ReadonlyArray<Eero>, networkName: string, offline: boolean) {
  const name = eero?.location ?? "eero";
  const restart = useWrite<{ eero: string }, RestartResult>("eero.restart", {
    confirm: { title: `Restart ${name}?`, confirmLabel: `Restart ${name}` },
  });
  const gate = useGate({ area: "eeros" });
  const restarting = eero?.status === "updating";
  const blocked = offline ? `${name} is offline` : restarting ? `${name} is restarting` : null;
  const run = async () => {
    if (!eero) return;
    const r = await restart.run({ eero: eero.id });
    if (r?.ok) watchRestart(r.result, eero.isGateway ? networkName : name);
  };
  return { run, running: restart.running, blocked, gate: blocked ? { allowed: false, reason: blocked } : gate, line: eero ? restartLine(eero, eeros, networkName) : null };
}

/** The Remove row at the end of "eero settings": a T3-style settings row with Remove eero… (type-the-name confirm). */
export function RemoveEeroRow({ eero, eeros, networkName }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; networkName: string }) {
  const name = eero?.location ?? "eero";
  const remove = useWrite<{ eero: string }, { location: string }>("eero.remove", {
    confirm: { title: `Remove "${name}" from ${networkName}?`, confirmLabel: "Remove from network", typeToConfirm: name },
    success: (r) => `${r.location} removed from ${networkName}`,
    failure: `Couldn't remove ${name}`,
  });
  const removeGate = useGate("eero.remove");
  // Core refuses the gateway while other eeros remain; the eero app replaces it.
  const removable = !!eero && (!eero.isGateway || eeros.length <= 1);
  const runRemove = async () => {
    if (!eero) return;
    const r = await remove.run({ eero: eero.id });
    if (r?.ok) navigate(pathFor("eeros", {}));
  };
  return (
    <SettingsRow
      title="Remove eero"
      description={eero && !removable ? "The gateway can't be removed while other eeros use it; replace it in the eero app." : `Removes ${name} from ${networkName} and resets it. Owner only.`}
      control={
        // Destructive text, outline; the ellipsis because it asks first (type the name).
        // The gateway keeps the button, disabled and dimmed, with the reason in its tooltip.
        <GatedButton
          size="sm"
          variant="outline"
          tone="danger"
          gate={eero && !removable ? { allowed: false, reason: "Disabled: the gateway can't be removed while other eeros use it" } : removeGate}
          disabled={!eero || remove.running}
          onClick={() => void runRemove()}
        >
          Remove eero…
        </GatedButton>
      }
    />
  );
}
