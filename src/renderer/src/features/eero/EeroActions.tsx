/**
 * eero detail "More actions": Blink light (`eero.find`, counts down while
 * blinking), Restart (`eero.restart`, disruptive: the engine's confirm in
 * the confirm dialog, naming the gateway outage or the eeros downstream,
 * then a progress toast until they are back) and Remove (`eero.remove`,
 * destructive: the confirm dialog with type-the-name, then back to eeros). The
 * gateway is offered only when it is the only eero, as core refuses it
 * otherwise. docs/ux/pages/eero-detail.md (Layout 5, Actions, States).
 */
import { Lightbulb, RotateCcw, Trash2 } from "lucide-react";

import { navigate, pathFor } from "~/app/router";
import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { GatedButton, Row, RowList, useGate } from "~/components/ui/page";
import { BlinkLightButton } from "~/features/eeros/EeroCards";
import { watchRestart } from "~/features/eeros/NetworkActions";
import type { RestartResult } from "../../../../core/commands/network";
import type { Eero } from "../../../../core/model";
import { restartLine } from "./helpers";

export function EeroActions({ eero, eeros, networkName, offline }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; networkName: string; offline: boolean }) {
  const name = eero?.location ?? "eero";
  const restart = useWrite<{ eero: string }, RestartResult>("eero.restart", {
    confirm: { title: `Restart ${name}?`, confirmLabel: `Yes, restart ${name}` },
  });
  const gate = useGate({ area: "eeros" });
  const restarting = eero?.status === "updating";
  const blocked = offline ? `${name} is offline` : restarting ? `${name} is restarting` : null;
  const actionGate = blocked ? { allowed: false, reason: blocked } : gate;
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
  const runRestart = async () => {
    if (!eero) return;
    const r = await restart.run({ eero: eero.id });
    if (r?.ok) watchRestart(r.result, eero.isGateway ? networkName : name);
  };

  return (
    <Section title="More actions">
      <div className="grid items-start gap-4 md:grid-cols-3">
        <RowList>
          <Row>
            <IconTile icon={Lightbulb} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px]">Blink light</div>
              <div className="text-muted-foreground text-xs">Flashes blue and white for 30 s so you can find it</div>
            </div>
            {eero && !blocked ? (
              <BlinkLightButton eero={eero} />
            ) : (
              <GatedButton size="xs" variant="outline" gate={actionGate}>
                <Lightbulb />
                Blink light
              </GatedButton>
            )}
          </Row>
        </RowList>
        <RowList>
          <Row>
            <IconTile icon={RotateCcw} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px]">Restart {name}</div>
              <div className="text-muted-foreground text-xs">{eero ? restartLine(eero, eeros, networkName) : "-"}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="warning">Disruptive</Badge>
              <GatedButton size="xs" variant="outline" gate={actionGate} disabled={!eero || restart.running} onClick={() => void runRestart()}>
                Restart
              </GatedButton>
            </div>
          </Row>
        </RowList>
        <RowList>
          <Row>
            <IconTile icon={Trash2} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px] text-destructive-foreground">Remove {name} eero</div>
              <div className="text-muted-foreground text-xs">
                {eero && !removable ? "The gateway can't be removed while other eeros use it; replace it in the eero app" : "Owner only · resets this eero"}
              </div>
            </div>
            {removable && (
              <GatedButton size="xs" variant="outline" gate={removeGate} disabled={remove.running} onClick={() => void runRemove()}>
                Remove
              </GatedButton>
            )}
          </Row>
        </RowList>
      </div>
    </Section>
  );
}
