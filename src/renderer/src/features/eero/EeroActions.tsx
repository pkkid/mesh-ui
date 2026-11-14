/**
 * eero detail "More actions": Blink LED (`eero.find`, counts down while
 * blinking), Restart (`eero.restart`, disruptive: the engine's confirm
 * inline, naming the gateway outage or the eeros downstream, then a progress
 * toast until they are back) and Remove (disabled, "Coming soon" until
 * `eero.remove` lands in M5). docs/ux/pages/eero-detail.md (Layout 5,
 * Actions, States).
 */
import { Lightbulb, RotateCcw, Trash2 } from "lucide-react";

import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Section } from "~/components/ui/card";
import { WriteConfirm } from "~/components/ui/confirm";
import { IconTile } from "~/components/ui/hero";
import { ComingSoonButton, GatedButton, Row, RowList, useGate } from "~/components/ui/page";
import { FindButton } from "~/features/eeros/EeroCards";
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
              <div className="font-medium text-[13px]">Blink LED</div>
              <div className="text-muted-foreground text-xs">Flashes blue and white for 30 s so you can find it</div>
            </div>
            {eero && !blocked ? (
              <FindButton eero={eero} label="Blink" />
            ) : (
              <GatedButton size="xs" variant="outline" gate={actionGate}>
                Blink
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
            {!restart.asking && (
              <div className="flex flex-col items-end gap-1">
                <Badge variant="warning">Disruptive</Badge>
                <GatedButton size="xs" variant="outline" gate={actionGate} disabled={!eero || restart.running} onClick={() => void runRestart()}>
                  Restart
                </GatedButton>
              </div>
            )}
          </Row>
          {restart.asking && (
            <div className="px-4 pb-3">
              <WriteConfirm write={restart}>{null}</WriteConfirm>
            </div>
          )}
        </RowList>
        <RowList>
          <Row>
            <IconTile icon={Trash2} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px] text-destructive-foreground">Remove {name} eero</div>
              <div className="text-muted-foreground text-xs">
                {eero?.isGateway ? "The gateway can't be removed here; replace it in the eero app" : "Owner only · resets this eero"}
              </div>
            </div>
            {!eero?.isGateway && (
              <ComingSoonButton size="xs" variant="outline">
                Remove
              </ComingSoonButton>
            )}
          </Row>
        </RowList>
      </div>
    </Section>
  );
}
