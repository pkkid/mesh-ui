/**
 * Smart home integrations from `integrations.get`: each with its state, or
 * "Unavailable" (dimmed, read only, with eero's reason) when eero does not
 * report it here. Frustration-Free Setup is shown read only: eero reports it,
 * but eero's own app has no switch for it (M5 review) and no client has
 * live-tested the write, so there is no command for it (M6.10). The
 * eero Built-in switch, Discover Zigbee devices and Unlink Amazon (destructive: the type-the-name
 * dialog) run through the write kit, gated by their command specs.
 * docs/ux/pages/advanced-networking.md (Integrations), mockup 13.
 */
import { type QueryState, useQuery } from "~/app/useCommand";
import { type Gate, useWrite } from "~/app/useWrite";
import { GatedButton, SectionError, useGate } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { Integration, IntegrationId, Integrations as IntegrationsData, Network } from "../../../../core/model";

import { Group, Row } from "./SettingsGroups";

const COPY: Record<IntegrationId, { title: string; description: string }> = {
  homekit: { title: "Apple HomeKit", description: "HomeKit router mode: manage device access from the Home app" },
  amazon: { title: "Amazon Connected Home", description: "Alexa and Echo features for this network" },
  builtin: { title: "eero Built-in", description: "Lets compatible Echo devices extend the mesh, for the whole network" },
  smart_home_hub: { title: "Smart Home Hub", description: "Zigbee and Matter controller on an eero" },
  ffs: { title: "Frustration-Free Setup", description: "Syncs Wi-Fi and Thread credentials to Amazon for easy device setup · set from your Amazon account" },
};

const ORDER: IntegrationId[] = ["homekit", "amazon", "builtin", "smart_home_hub", "ffs"];

function description(id: IntegrationId, i: Integration | undefined): string {
  const base = COPY[id].description;
  if (!i?.detail) return base;
  return i.available ? `${base} · ${i.detail}` : i.detail;
}

/** An on or off switch for a write; dims with the gate's reason. null (unknown) cannot be flipped. */
function Switch({ on, label, gate, onChange }: { on: boolean | null | undefined; label: string; gate: Gate; onChange: (on: boolean) => void }) {
  const known = on === true || on === false;
  return (
    <span title={gate.reason ?? (known ? undefined : "eero does not report this setting")} className="inline-flex">
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={!gate.allowed || !known}
        onClick={() => onChange(!on)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-70",
          on === true ? "border-transparent bg-primary" : "bg-muted",
          !known && "border-dashed",
        )}
      >
        <i className={cn("absolute size-3.5 rounded-full bg-background shadow-sm transition-[left]", on === true ? "left-[18px]" : "left-0.5")} />
      </button>
    </span>
  );
}

/** A switch row's control: `integrations.<id>.set`, with a toast and Undo. */
function IntegrationSwitch({ id, on }: { id: "builtin"; on: boolean | null | undefined }) {
  const command = `integrations.${id}.set`;
  const gate = useGate(command);
  const write = useWrite<{ enabled: boolean }, IntegrationsData>(command);
  const title = COPY[id].title;
  const busy: Gate = write.running ? { allowed: false, reason: null } : gate;
  return (
    <Switch
      on={on}
      label={title}
      gate={busy}
      onChange={(enabled) =>
        void write.run(
          { enabled },
          {
            // Disruptive: turning it off drops devices connected through an Echo. Core's message says so.
            confirm: { title: `Turn ${enabled ? "on" : "off"} ${title}?`, confirmLabel: `Turn ${enabled ? "on" : "off"}` },
            success: `${title} ${enabled ? "on" : "off"}`,
            undo: { id: command, params: { enabled: !enabled }, confirm: { title: `Turn ${enabled ? "off" : "on"} ${title}?`, confirmLabel: `Turn ${enabled ? "off" : "on"}` } },
          },
        )
      }
    />
  );
}

function DiscoverZigbee() {
  const gate = useGate("integrations.zigbee.discover");
  const write = useWrite("integrations.zigbee.discover");
  return (
    <GatedButton
      size="xs"
      variant="outline"
      gate={gate}
      disabled={write.running}
      onClick={() => void write.run({}, { success: "Looking for Zigbee devices. Finish pairing in the Alexa app", failure: "Couldn't start Zigbee discovery" })}
    >
      Discover Zigbee devices
    </GatedButton>
  );
}

function UnlinkAmazon() {
  const gate = useGate("integrations.amazon.unlink");
  const network = useQuery<Network>("network.get");
  const name = network.data?.name ?? null;
  const write = useWrite<Record<string, never>, IntegrationsData>("integrations.amazon.unlink");
  return (
    <GatedButton
      size="xs"
      variant="outline"
      className="text-destructive-foreground"
      gate={gate}
      disabled={write.running || name === null}
      onClick={() =>
        void write.run(
          {},
          {
            success: `Unlinked Amazon from ${name}`,
            failure: "Couldn't unlink Amazon",
            confirm: { title: `Unlink Amazon from ${name}?`, confirmLabel: "Unlink Amazon", typeToConfirm: name ?? undefined },
          },
        )
      }
    >
      Unlink Amazon
    </GatedButton>
  );
}

/** `owner` is kept for AdvancedPage; Unlink Amazon reads the owner rule from its gate. */
export function Integrations({ query }: { query: QueryState<IntegrationsData>; owner: boolean }) {
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
              <UnlinkAmazon />
            </>
          ) : i ? (
            <span className="text-muted-foreground text-xs">Link in the eero app</span>
          ) : null;
        else if (id === "smart_home_hub") control = i ? <DiscoverZigbee /> : null;
        else if (id === "builtin") control = <IntegrationSwitch id={id} on={i?.enabled} />;
        else if (id === "ffs") control = i?.enabled === true ? <Status tone="success">On</Status> : i?.enabled === false ? <Status tone="muted">Off</Status> : null;
        // HomeKit has no write: eero sets it up from the Home app.
        else control = <Switch on={i?.enabled} label={COPY[id].title} gate={{ allowed: false, reason: "Set up in the Apple Home app" }} onChange={() => {}} />;
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
