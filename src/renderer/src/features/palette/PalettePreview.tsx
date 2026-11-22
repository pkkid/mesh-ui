/**
 * The palette preview (docs/ux/pages/command-palette.md#layout): what the
 * selected result is, its params form, and the same call as a CLI line and
 * an MCP tool call, so every surface reads the same. After a command runs,
 * its result JSON shows under the MCP call. Confirms open in a dialog over
 * the palette (CommandPalette).
 */
import { ArrowRight, Check, Copy, Play, Terminal } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import { Status } from "~/components/ui/status";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import type { ExecuteResult } from "../../../../core/errors";
import { JsonTree } from "../devtools/JsonTree";
import { EeroBadges, EffectTag } from "./PaletteResults";
import { type EntityOptions, ParamsForm } from "./ParamsForm";
import { cliLine, type Item, mcpCall, needsConfirm, type ParamField } from "./search";

export type RunState = { running: boolean; result: ExecuteResult | null };

type Props = {
  item: Item;
  fields: ReadonlyArray<ParamField>;
  /** Everything in the form, defaults included. */
  values: Record<string, unknown>;
  /** What the CLI and MCP lines show: only the params the user chose. */
  chosen: Record<string, unknown>;
  onValuesChange: (values: Record<string, unknown>) => void;
  errors: Record<string, string>;
  entities: EntityOptions;
  run: RunState;
  onRun: () => void;
  /** Runs the selected eero, device or profile's details read (`device.get`, ...) and shows the result in line. */
  onRunDetails: () => void;
  /** Why the run button is disabled, or null. */
  blocked: string | null;
  runLabel: string;
  onCopy: () => Promise<boolean>;
};

export function PalettePreview(props: Props) {
  const { item } = props;
  return (
    // The panel's own background and corners come from its frame in CommandPalette (the sidebar colour).
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-fade-y flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {item.kind === "command" ? (
          <CommandPreview {...props} item={item} />
        ) : (
          <EntityPreview item={item} run={props.run} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-5 py-3">
        <span title={props.blocked ?? undefined} className="inline-flex">
          {/* Outline: the palette has no call to action, so nothing in it is a filled button. */}
          <Button size="sm" variant="outline" className="[&_svg]:text-muted-foreground" onClick={props.onRun} disabled={props.blocked !== null || props.run.running}>
            {/* Play runs a command; an arrow goes to a place, eero, device or profile. */}
            {props.item.kind === "command" ? <Play /> : <ArrowRight />}
            {props.runLabel}
          </Button>
        </span>
        {/* An eero, device or profile also runs its details read in line; Enter still goes to it. */}
        {(item.kind === "eero" || item.kind === "device" || item.kind === "profile") && (
          <Button size="sm" variant="outline" className="[&_svg]:text-muted-foreground" onClick={props.onRunDetails} disabled={props.run.running}>
            <Play />
            Run command
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The details read for an eero, device or profile (`eero.get`, `device.get`, `profile.get`) as the CLI line and the
 * MCP tool call, so an agent or script can fetch the same thing the page shows.
 */
function DetailsCall({ item, run }: { item: Exclude<Item, { kind: "command" }>; run: RunState }) {
  const [copied, setCopied] = useState(false);
  if (item.kind === "page") return null;
  const id = `${item.kind}.get`;
  const params = { [item.kind]: item.id };
  const line = cliLine(id, params, "query");
  return (
    <>
      <div>
        <Label right={
            // The app's plain copy icon (as Get help's and the CLI codes on Settings): no label, a check once copied.
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Copy command"
              title="Copy command"
              onClick={async () => {
                if (await copyText(line, { toast: false })) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          }
        >
          CLI
        </Label>
        <Code>
          <span className="select-none text-muted-foreground/70">$ </span>
          {line}
        </Code>
      </div>
      <div>
        <Label>
          MCP tool
        </Label>
        <Code>{JSON.stringify(mcpCall(id, params, "query"))}</Code>
        <RunResult run={run} />
      </div>
    </>
  );
}

/** A run's result under the MCP tool call: "Running...", then the envelope as the dev tools show a response. */
function RunResult({ run }: { run: RunState }) {
  return (
    <>
      {run.running && <p className="mt-1.5 text-muted-foreground text-xs">Running...</p>}
      {run.result && (
        <div data-selectable className="mt-1.5 max-h-80 overflow-auto rounded-[10px] bg-muted px-3 py-2.5">
          <p className="mb-1 font-mono text-[11px] text-muted-foreground/70">{"// the same result the UI and CLI get"}</p>
          <JsonTree text={JSON.stringify(run.result)} />
        </div>
      )}
    </>
  );
}

function Label({ icon: Icon, children, right }: { icon?: typeof Terminal; children: ReactNode; right?: ReactNode }) {
  return (
    // A sub heading in the panel: normal case in the text colour, as section titles are (never uppercase).
    <div className="mb-1.5 flex min-h-5 items-center gap-2 font-medium text-[13px] text-foreground">
      {Icon && <Icon className="size-3" />}
      {children}
      {right && <span className="ms-auto flex items-center gap-1.5 font-normal text-muted-foreground text-xs">{right}</span>}
    </div>
  );
}

function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      data-selectable
      className={cn(
        // Code reads dimmer than the headings above it, on a plain background (no border).
        "m-0 whitespace-pre-wrap break-words rounded-[10px] bg-muted px-3 py-2.5 font-mono text-[11.5px] text-muted-foreground leading-[1.55]",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function CommandPreview({
  item,
  fields,
  values,
  chosen,
  onValuesChange,
  errors,
  entities,
  run,
  onCopy,
}: Props & { item: Extract<Item, { kind: "command" }> }) {
  const { info } = item;
  const [copied, setCopied] = useState(false);
  const call = mcpCall(info.id, chosen, info.effect);
  const confirmNote = needsConfirm(info.effect)
    ? "Needs confirm: true on every surface."
    : info.effect === "query"
      ? "Read-only."
      : "Reversible, no confirm needed.";

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          {/* The effect tag on the right of the title line. */}
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold text-base">{item.label}</span>
            <EffectTag effect={info.effect} className="ms-auto" />
          </div>
          <div className="mt-1 truncate font-mono text-muted-foreground text-xs">{info.id}</div>
        </div>
      </div>
      {/* What it does reads as secondary text, all of it muted (the confirm note was already). */}
      <p className="-mt-1 text-[13px] text-muted-foreground">
        {info.description ? `${info.description} ` : ""}
        <span className="text-muted-foreground">{confirmNote}</span>
        {item.unavailable && <span className="text-muted-foreground"> Can't run here: {item.unavailable}.</span>}
      </p>

      <div data-params>
        <Label>Params</Label>
        <ParamsForm key={item.key} fields={fields} values={values} onChange={onValuesChange} errors={errors} entities={entities} />
      </div>

      <div>
        <Label right={
            // The app's plain copy icon (as Get help's and the CLI codes on Settings): no label, a check once copied.
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Copy command"
              title="Copy command"
              onClick={async () => {
                if (await onCopy()) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          }
        >
          CLI
        </Label>
        <Code>
          <span className="select-none text-muted-foreground/70">$ </span>
          {cliLine(info.id, chosen, info.effect)}
        </Code>
      </div>

      <div>
        <Label>
          MCP tool
        </Label>
        <Code>{JSON.stringify(call)}</Code>
        <RunResult run={run} />
      </div>

    </>
  );
}

function EntityPreview({ item, run }: { item: Exclude<Item, { kind: "command" }>; run: RunState }) {
  const what =
    item.kind === "page" ? (item.place === "section" ? "Section" : item.place === "setting" ? "Setting" : "Page") : item.kind === "eero" ? "eero" : item.kind === "device" ? "Device" : "Profile";
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-base">{item.label}</span>
          {item.kind === "eero" && <EeroBadges item={item} />}
          {"state" in item && item.state && (
            <Status tone={item.state === "Scheduled" ? "info" : item.state === "Offline" ? "muted" : "warning"}>{item.state}</Status>
          )}
          </div>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {what}
            {"context" in item && item.context ? ` · ${item.context}` : ""}
            {item.kind === "page" && !item.anchor ? ` · ${item.path}` : ""}
          </div>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {item.kind === "page"
          ? item.anchor
            ? `Opens ${item.context} at ${item.label}.`
            : `Opens the ${item.label} page.`
          : `Opens ${item.label} in its ${what.toLowerCase()} page.`}
      </p>
      <DetailsCall item={item} run={run} />
    </>
  );
}
