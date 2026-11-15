/**
 * eero detail "Ethernet ports": a tile per port (status, a jack with link
 * lights, negotiated and supported speed, everything plugged in), the port
 * MACs, and the port actions eero lists (`eero.port.action`, disruptive: the
 * engine's confirm in the dialog, then a toast with Undo running the opposite
 * action, also confirmed). docs/ux/pages/eero-detail.md (Layout 3).
 * Data: `eero.ports.get {eero}`.
 */
import { Power } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite, type WriteRequest } from "~/app/useWrite";
import { linkSpeed } from "~/components/mesh/LinkChip";
import { Card, Empty, Section } from "~/components/ui/card";
import { KvList } from "~/components/ui/kv-list";
import { GatedButton, SectionError, useGate } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { MISSING } from "../../../../core/format";
import { type Eero, type EeroPort, INVERSE_PORT_ACTION, type EeroPorts as Ports, type PortAction } from "../../../../core/model";
import { portName, portsLine } from "./helpers";

/** Button label, toast and a short consequence per action. `n` is the port name ("Port 3"). */
const ACTION: Record<PortAction, { label: (n: string) => string; done: (n: string) => string; consequence: (attached: string | null) => string }> = {
  DISABLE_PORT: { label: (n) => `Disable ${n.toLowerCase()}`, done: (n) => `${n} disabled`, consequence: (a) => (a ? `${a} loses its wired connection` : "Nothing is plugged in") },
  ENABLE_PORT: { label: (n) => `Enable ${n.toLowerCase()}`, done: (n) => `${n} enabled`, consequence: () => "Turns the port back on" },
  DISABLE_DATA: { label: (n) => `Disable data on ${n.toLowerCase()}`, done: (n) => `Data off on ${n.toLowerCase()}`, consequence: () => "Keeps PoE power, stops data" },
  ENABLE_DATA: { label: (n) => `Enable data on ${n.toLowerCase()}`, done: (n) => `Data on for ${n.toLowerCase()}`, consequence: () => "Turns data back on" },
  DISABLE_POE: { label: (n) => `Turn off PoE on ${n.toLowerCase()}`, done: (n) => `PoE off on ${n.toLowerCase()}`, consequence: () => "Cuts power to the device" },
  ENABLE_POE: { label: (n) => `Turn on PoE on ${n.toLowerCase()}`, done: (n) => `PoE on for ${n.toLowerCase()}`, consequence: () => "Powers the device again" },
  RESTART_POWER: { label: (n) => `Restart PoE on ${n.toLowerCase()}`, done: (n) => `PoE restarted on ${n.toLowerCase()}`, consequence: () => "Power-cycles the device" },
};

type PortParams = { eero: string; port: number; action: PortAction };

/** One port action as a write request: confirm copy from core, success toast, and Undo with the opposite action. */
function portRequest(eeroId: string, port: EeroPort, action: PortAction, location: string): WriteRequest<PortParams, Ports> {
  const name = portName(port);
  const words = ACTION[action];
  const inverse = INVERSE_PORT_ACTION[action];
  return {
    id: "eero.port.action",
    params: { eero: eeroId, port: port.number, action },
    confirm: { title: `${words.label(name)} on ${location}?`, confirmLabel: words.label(name) },
    success: `${words.done(name)} on ${location}`,
    failure: `Couldn't ${words.label(name).charAt(0).toLowerCase()}${words.label(name).slice(1)}`,
    // Undo is the opposite action; it asks again, since it is disruptive too.
    // Built lazily: the undo's own undo is this action again.
    undo: inverse ? () => portRequest(eeroId, port, inverse, location) as WriteRequest : undefined,
  };
}

export function EeroPorts({ eeroId, offline }: { eeroId: string; offline: boolean }) {
  const ports = useQuery<Ports>("eero.ports.get", { eero: eeroId }, { poll: true, enabled: eeroId !== "" });
  // The page reads the same eero, so this shares its cached answer.
  const location = useQuery<Eero>("eero.get", { eero: eeroId }, { enabled: eeroId !== "" }).data?.location ?? "this eero";
  const write = useWrite<PortParams, Ports>("eero.port.action");
  const gate = useGate("eero.port.action");
  const actionGate = offline ? { allowed: false, reason: `${location} is offline` } : gate;
  const list = ports.data?.ports;
  const actions = (list ?? []).flatMap((p) => p.actions.map((a) => ({ port: p, action: a, words: ACTION[a] })));
  const run = (port: EeroPort, action: PortAction) => {
    const { params, ...options } = portRequest(eeroId, port, action, location);
    void write.run(params, options);
  };

  return (
    <Section title="Ethernet ports" subtitle={list ? portsLine(list) : null}>
      {ports.error && !ports.data ? (
        <SectionError what="ports" error={ports.error} onRetry={() => void ports.refetch()} />
      ) : list && list.length === 0 ? (
        <Card>
          <Empty>Port details aren't available for this model.</Empty>
        </Card>
      ) : (
        <Card padded className={cn("flex flex-col gap-3 transition-opacity", ports.fading && "opacity-40")}>
          <div className="grid grid-cols-2 gap-2.5">
            {(list ?? [null, null]).map((p, i) => (
              <PortTile key={p?.number ?? i} port={p} offline={offline} />
            ))}
          </div>
          {list && (
            <KvList
              className="text-xs"
              items={list.map((p) => ({ label: `${portName(p)} MAC`, value: p.mac, mono: true }))}
            />
          )}
          {actions.map(({ port, action, words }) => (
            <div key={`${port.number}-${action}`} className="flex items-center gap-2">
              <GatedButton size="xs" variant="outline" gate={actionGate} disabled={write.running} onClick={() => run(port, action)}>
                <Power />
                {words.label(portName(port))}
              </GatedButton>
              <span className="text-2xs text-muted-foreground">{words.consequence(port.attached?.name ?? null)}</span>
            </div>
          ))}
        </Card>
      )}
    </Section>
  );
}

function portStatus(p: EeroPort | null, offline: boolean): { tone: StatusTone; label: string } {
  if (!p || offline) return { tone: "muted", label: MISSING };
  if (p.status === "disabled") return { tone: "warning", label: "Disabled" };
  return p.status === "up" ? { tone: "success", label: "Up" } : { tone: "muted", label: "Empty" };
}

function PortTile({ port: p, offline }: { port: EeroPort | null; offline: boolean }) {
  const status = portStatus(p, offline);
  const up = !offline && p?.status === "up";
  const speed = up ? linkSpeed(p?.speedMbps) : null;
  const supported = linkSpeed(p?.supportedMbps);
  const [value, unit] = speed ? speed.split(" ") : [MISSING, ""];
  const attachments = p?.isWan ? [] : (p?.attachments ?? []);
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-xs">{p ? portName(p) : MISSING}</span>
        <Status tone={status.tone}>{status.label}</Status>
      </div>
      <Jack up={up} />
      <div className="text-center">
        <div className={cn("font-medium text-lg tabular-nums", !speed && "text-muted-foreground")}>
          {value}
          {unit && <small className="ms-1 font-normal text-muted-foreground text-xs">{unit}</small>}
        </div>
        <div className="text-2xs text-muted-foreground">{speed ? (supported ? `of ${supported} supported` : "negotiated") : up ? "speed not reported" : "no carrier"}</div>
      </div>
      <div className={cn("flex flex-col items-center text-center text-xs", !p?.isWan && attachments.length === 0 && "text-muted-foreground")}>
        {offline || !p ? (
          MISSING
        ) : p.isWan ? (
          "Internet"
        ) : attachments.length > 0 ? (
          attachments.map((a, i) => <Attachment key={a.deviceId ?? a.eeroId ?? i} attachment={a} />)
        ) : up ? (
          "Unknown device"
        ) : p.status === "disabled" ? (
          "Turned off"
        ) : (
          "Nothing plugged in"
        )}
      </div>
    </div>
  );
}

/** One thing behind a port, linked to its device or eero page when known. */
function Attachment({ attachment: a }: { attachment: EeroPort["attachments"][number] }) {
  const name = a.name ?? "Unknown device";
  const to = a.deviceId ? pathFor("device", { deviceId: a.deviceId }) : a.eeroId ? pathFor("eero", { eeroId: a.eeroId }) : null;
  return (
    <span className="max-w-full truncate" title={name}>
      {to ? (
        <Link to={to} className="hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
    </span>
  );
}

/** An RJ45 jack outline with two link lights, lit while the port has carrier. */
function Jack({ up }: { up: boolean }) {
  return (
    <div aria-hidden className="relative mx-auto h-9 w-12 rounded-[5px] border-2 border-border bg-muted">
      <span className="absolute -bottom-0.5 left-1/2 h-2 w-5 -translate-x-1/2 rounded-t-[3px] border-2 border-border border-b-0 bg-card" />
      <i className={cn("absolute top-1 left-1 size-1.5 rounded-full", up ? "bg-success" : "bg-border")} />
      <i className={cn("absolute top-1 right-1 size-1.5 rounded-full", up ? "bg-success/60" : "bg-border")} />
    </div>
  );
}
