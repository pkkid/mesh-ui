/**
 * "Network actions": Restart network, disruptive. Disabled ("Coming soon")
 * until `network.restart` lands; it will then confirm inline first.
 * docs/ux/pages/eeros.md (Layout 3, Actions).
 */
import { RotateCcw } from "lucide-react";

import { Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { ComingSoonButton, Row, RowList } from "~/components/ui/page";

export function NetworkActions() {
  return (
    <Section title="Network actions">
      <RowList>
        <Row>
          <IconTile icon={RotateCcw} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[13.5px]">Restart network</div>
            <div className="text-muted-foreground text-xs">Restarts every eero at once. Disruptive: everyone loses internet for 2 to 3 minutes.</div>
          </div>
          <ComingSoonButton size="xs" variant="outline">
            Restart
          </ComingSoonButton>
        </Row>
      </RowList>
    </Section>
  );
}
