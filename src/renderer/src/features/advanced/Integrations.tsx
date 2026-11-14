/**
 * Smart home integrations from `integrations.get`: each with its state, or
 * "Unavailable" (dimmed) when eero does not report it here. Unlinking Amazon
 * and the switches come later. docs/ux/pages/advanced-networking.md
 * (Integrations), mockup 13.
 */
import type { QueryState } from "~/app/useCommand";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import type { Integration, IntegrationId, Integrations as IntegrationsData } from "../../../../core/model";

import { Group, ReadSwitch, Row } from "./SettingsGroups";

const COPY: Record<IntegrationId, { title: string; description: string }> = {
  homekit: { title: "Apple HomeKit", description: "HomeKit router mode: manage device access from the Home app" },
  amazon: { title: "Amazon Connected Home", description: "Alexa and Echo features for this network" },
  builtin: { title: "eero Built-in", description: "Lets compatible Echo devices extend the mesh, for the whole network" },
  smart_home_hub: { title: "Smart Home Hub", description: "Zigbee and Matter controller on an eero" },
  ffs: { title: "Frustration-Free Setup", description: "Syncs Wi-Fi and Thread credentials to Amazon for easy device setup" },
};

const ORDER: IntegrationId[] = ["homekit", "amazon", "builtin", "smart_home_hub", "ffs"];

function description(id: IntegrationId, i: Integration | undefined): string {
  const base = COPY[id].description;
  if (!i?.detail) return base;
  return i.available ? `${base} · ${i.detail}` : i.detail;
}

export function Integrations({ query, owner }: { query: QueryState<IntegrationsData>; owner: boolean }) {
  const data = query.data;
  if (query.error && !data) return <SectionError what="integrations" error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <Group title="Integrations" subtitle="Smart home platforms">
      {ORDER.map((id) => {
        const i = data?.[id];
        const unavailable = i !== undefined && !i.available;
        let control = null;
        if (unavailable) control = <Status tone="muted">Unavailable</Status>;
        else if (id === "amazon")
          control = i?.enabled ? (
            <>
              <Status tone="success">Linked</Status>
              <ComingSoonButton size="xs" variant="outline" className="text-destructive-foreground" title={owner ? "Coming soon" : "Owner only"}>
                Unlink Amazon
              </ComingSoonButton>
            </>
          ) : i ? (
            <span className="text-muted-foreground text-xs">Link in the eero app</span>
          ) : null;
        else if (id === "smart_home_hub")
          control = (
            <ComingSoonButton size="xs" variant="outline">
              Discover Zigbee devices
            </ComingSoonButton>
          );
        else control = <ReadSwitch on={i?.enabled} label={COPY[id].title} />;
        return (
          <Row
            key={id}
            title={COPY[id].title}
            description={description(id, i) + (id === "amazon" && i?.available ? " · owner only" : "")}
            dim={unavailable}
            control={control}
          />
        );
      })}
    </Group>
  );
}
