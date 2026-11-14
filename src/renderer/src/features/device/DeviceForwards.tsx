/**
 * Device detail "Port forwarding" (docs/ux/pages/device-detail.md, Layout 2):
 * one row per forward to this device from `forward.list {device}`, with the
 * name, port or range, protocol and a trash button; a disabled forward is
 * muted with an off switch that turns it back on. The trash button removes
 * (after a confirm, with Undo) and + Open a port opens the port forward
 * sheet with this device picked (features/ports/RuleSheet.tsx). Hidden for
 * guest devices and in bridge mode (DevicePage).
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import type { Gate } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, HeaderLink, SectionError, useGate } from "~/components/ui/page";
import { ForwardSheet, type ForwardSheetMode, removeForward, setForwardEnabled } from "~/features/ports/RuleSheet";
import { cn } from "~/lib/utils";
import type { ForwardList } from "../../../../core/commands/routing";
import type { Forward, Protocol } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

const PROTOCOL: Record<Protocol, string> = { tcp: "TCP", udp: "UDP", both: "TCP+UDP" };

const GRID = "grid grid-cols-[minmax(0,1fr)_7rem_4.5rem_1.75rem] items-center gap-3";

export function DeviceForwards({ view, id }: { view: DeviceView; id: string }) {
  const forwards = useQuery<ForwardList>("forward.list", { device: id }, { poll: 60 });
  const rows = forwards.data?.forwards;
  const blocked = view.device?.blocked === true;
  const [sheet, setSheet] = useState<ForwardSheetMode | null>(null);
  const addGate = useGate("forward.add");
  const editGate = useGate("forward.update");
  const removeGate = useGate("forward.remove");

  return (
    <Section
      title="Port forwarding"
      tools={
        <HeaderLink to={pathFor("ports")} arrow>
          All
        </HeaderLink>
      }
    >
      <ForwardSheet mode={sheet} onClose={() => setSheet(null)} />
      {forwards.error && !rows ? (
        <SectionError what="port forwards" error={forwards.error} onRetry={() => void forwards.refetch()} />
      ) : (
        <Card padded className={cn("pt-3.5 pb-3", forwards.fading && "opacity-40")}>
          {rows && rows.length === 0 ? (
            <Empty className="px-0 py-4">{forwards.data?.unavailable ?? "No ports open to this device."}</Empty>
          ) : (
            <div role="table" aria-label="Port forwards" className="text-[13px]">
              <div role="row" className={cn(GRID, "pb-1 text-muted-foreground text-xs")}>
                <span role="columnheader">Port forward</span>
                <span role="columnheader">Port</span>
                <span role="columnheader">Protocol</span>
                <span role="columnheader" className="sr-only">
                  Actions
                </span>
              </div>
              {(rows ?? []).map((f) => (
                <Row key={f.id} forward={f} editGate={editGate} removeGate={removeGate} />
              ))}
              {!rows && <div className="h-[34px]" />}
            </div>
          )}
          {!blocked && (
            <GatedButton gate={addGate} size="xs" variant="outline" className="mt-2" onClick={() => setSheet({ kind: "add", deviceId: id })}>
              <Plus />
              Open a port
            </GatedButton>
          )}
        </Card>
      )}
    </Section>
  );
}

function Row({ forward: f, editGate, removeGate }: { forward: Forward; editGate: Gate; removeGate: Gate }) {
  const port = f.externalPort === f.internalPort ? f.externalPort : `${f.externalPort} → ${f.internalPort}`;
  return (
    <div role="row" className={cn(GRID, "min-h-[34px] border-border/50 border-t")}>
      <span role="cell" className={cn("truncate font-medium", !f.enabled && "text-muted-foreground")}>
        {f.name || "Port forward"}
      </span>
      <span role="cell" className={cn("truncate font-mono text-xs tabular-nums", !f.enabled && "text-muted-foreground")}>
        {port}
      </span>
      <span role="cell">
        <Badge variant="outline" className="text-2xs">
          {PROTOCOL[f.protocol]}
        </Badge>
      </span>
      <span role="cell" className="flex justify-end">
        {f.enabled ? (
          <button
            type="button"
            disabled={!removeGate.allowed}
            title={removeGate.allowed ? `Remove ${f.name || "port forward"}` : (removeGate.reason ?? undefined)}
            aria-label={`Remove ${f.name}`}
            onClick={() => void removeForward(f)}
            className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={false}
            aria-label={`${f.name} is off`}
            disabled={!editGate.allowed}
            title={editGate.allowed ? "Off. Turn it on" : (editGate.reason ?? undefined)}
            onClick={() => void setForwardEnabled(f, true)}
            className="inline-flex h-3.5 w-6 cursor-pointer items-center rounded-full bg-muted p-0.5 shadow-[inset_0_0_0_1px_var(--color-border)] disabled:cursor-not-allowed"
          >
            <span className="size-2.5 rounded-full bg-muted-foreground/60" />
          </button>
        )}
      </span>
    </div>
  );
}
