/**
 * eero detail "More actions": Blink LED, Restart and Remove. All three are
 * disabled ("Coming soon") until `eero.find`, `eero.restart` and
 * `eero.remove` land; the copy already names what each would do.
 * docs/ux/pages/eero-detail.md (Layout 5, States, Notes).
 */
import { Lightbulb, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { IconTile } from "~/components/ui/hero";
import { ComingSoonButton, Row, RowList } from "~/components/ui/page";
import { Section } from "~/components/ui/card";
import type { Eero } from "../../../../core/model";
import { restartLine } from "./helpers";

export function EeroActions({ eero, eeros, networkName, offline }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; networkName: string; offline: boolean }) {
  const name = eero?.location ?? "eero";
  const blocked = offline ? `${name} is offline` : "Coming soon";
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
            <ComingSoonButton size="xs" variant="outline" title={blocked}>
              Blink
            </ComingSoonButton>
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
              <ComingSoonButton size="xs" variant="outline" title={blocked}>
                Restart
              </ComingSoonButton>
            </div>
          </Row>
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
