/**
 * The palette preview (docs/ux/pages/command-palette.md#layout): what the
 * selected result is, its params form, and the same call as a CLI line and
 * an MCP tool call, so every surface reads the same. After a query runs, its
 * result JSON shows under the MCP call.
 */
import { AppWindow, Bot, Check, Copy, FileJson, Play, SquareTerminal, Terminal } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import { IconTile } from "~/components/ui/hero";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { ExecuteResult } from "../../../../core/errors";
import { EffectTag, itemIcon, Keys } from "./PaletteResults";
import { type EntityOptions, ParamsForm } from "./ParamsForm";
import { cliLine, type Item, mcpCall, mcpHints, needsConfirm, type ParamField, toolName } from "./search";

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
  /** Why the run button is disabled, or null. */
  blocked: string | null;
  runLabel: string;
  onCopy: () => Promise<boolean>;
};

export function PalettePreview(props: Props) {
  const { item } = props;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {item.kind === "command" ? <CommandPreview {...props} item={item} /> : <EntityPreview item={item} />}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
        <span title={props.blocked ?? undefined} className="inline-flex">
          <Button size="sm" onClick={props.onRun} disabled={props.blocked !== null || props.run.running}>
            <Play />
            {props.runLabel}
            <Keys keys={["↵"]} className="ms-1 opacity-70 [&_kbd]:border-current/35 [&_kbd]:bg-transparent [&_kbd]:text-current [&_kbd]:shadow-none" />
          </Button>
        </span>
        {item.kind === "command" && (
          <span title="Coming soon" className="inline-flex">
            <Button size="sm" variant="outline" disabled>
              <FileJson />
              Add to script.jsonl
            </Button>
          </span>
        )}
        {props.blocked && <span className="truncate text-muted-foreground text-xs">{props.blocked}</span>}
      </div>
    </div>
  );
}

function Label({ icon: Icon, children, right }: { icon?: typeof Terminal; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-5 items-center gap-2 font-semibold text-[10.5px] text-muted-foreground/80 uppercase tracking-widest">
      {Icon && <Icon className="size-3" />}
      {children}
      {right && <span className="ms-auto flex items-center gap-1.5 font-medium normal-case tracking-normal">{right}</span>}
    </div>
  );
}

function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      data-selectable
      className={cn(
        "m-0 whitespace-pre-wrap break-words rounded-[10px] border bg-muted px-3 py-2.5 font-mono text-[11.5px] text-foreground/85 leading-[1.55]",
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
  const hints = mcpHints(info.id, info.effect);
  const call = mcpCall(info.id, chosen, info.effect);
  const confirmNote = needsConfirm(info.effect)
    ? "Needs confirm: true on every surface."
    : info.effect === "query"
      ? "Read-only."
      : "Reversible, no confirm needed.";

  return (
    <>
      <div className="flex items-start gap-3">
        <IconTile icon={itemIcon(item)} size="lg" />
        <div className="min-w-0 grow">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-base">{item.label}</span>
            <EffectTag effect={info.effect} />
          </div>
          <div className="mt-1 truncate font-mono text-muted-foreground text-xs">{info.id}</div>
        </div>
      </div>
      <p className="-mt-1 text-[13px] text-foreground/85">
        {info.description ? `${info.description} ` : ""}
        <span className="text-muted-foreground">{confirmNote}</span>
        {item.unavailable && <span className="text-muted-foreground"> {item.unavailable} in the palette.</span>}
      </p>

      <div data-params>
        <Label right={<span className="text-[10px] text-muted-foreground">JSON Schema · Tab to edit</span>}>Params</Label>
        <ParamsForm key={item.key} fields={fields} values={values} onChange={onValuesChange} errors={errors} entities={entities} />
      </div>

      <div>
        <Label
          icon={Terminal}
          right={
            <Button
              size="xs"
              variant="ghost-muted"
              className="h-5"
              onClick={async () => {
                if (await onCopy()) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
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
        <Label
          icon={Bot}
          right={
            <>
              <HintBadge>readOnly: {String(hints.readOnlyHint)}</HintBadge>
              <HintBadge>destructive: {String(hints.destructiveHint)}</HintBadge>
            </>
          }
        >
          MCP tool <span className="font-mono text-foreground/80 normal-case tracking-normal">{toolName(info.id)}</span>
        </Label>
        <Code>{JSON.stringify(call)}</Code>
        {run.running && <p className="mt-1.5 text-muted-foreground text-xs">Running...</p>}
        {run.result && (
          <Code className={cn("mt-1.5 max-h-80 overflow-auto", !run.result.ok && "text-destructive-foreground")}>
            <span className="text-muted-foreground/70">{"// the same result the UI and CLI get"}</span>
            {"\n"}
            <span data-palette-result>{JSON.stringify(run.result, null, 2)}</span>
          </Code>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Surface icon={AppWindow} name="UI" detail="window.mesh" />
        <Surface icon={SquareTerminal} name="CLI" detail="mesh-ui run" />
        <Surface icon={Bot} name="MCP" detail="mesh-ui mcp" />
      </div>
      <p className="-mt-1.5 text-[11px] text-muted-foreground">
        One registry, one <span className="font-mono">engine.execute(id, params)</span>. Disruptive and destructive commands
        need <span className="font-mono">confirm: true</span> on every surface.
      </p>
    </>
  );
}

function HintBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-sm border bg-muted px-1.5 font-mono text-[10.5px] text-foreground/80">{children}</span>;
}

function Surface({ icon: Icon, name, detail }: { icon: typeof Terminal; name: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border bg-muted px-2.5 py-2 text-xs">
      <Icon className="size-[15px] shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        {name}
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

function EntityPreview({ item }: { item: Exclude<Item, { kind: "command" }> }) {
  const what = item.kind === "page" ? "Page" : item.kind === "device" ? "Device" : "Profile";
  return (
    <>
      <div className="flex items-start gap-3">
        <IconTile icon={itemIcon(item)} size="lg" />
        <div className="min-w-0 grow">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-base">{item.label}</span>
            {"state" in item && item.state && (
              <Status tone={item.state === "Scheduled" ? "info" : item.state === "Offline" ? "muted" : "warning"}>{item.state}</Status>
            )}
          </div>
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {what}
            {"context" in item && item.context ? ` · ${item.context}` : ""}
            {item.kind === "page" ? ` · ${item.path}` : ""}
          </div>
        </div>
      </div>
      <p className="text-[13px] text-foreground/85">
        {item.kind === "page" ? `Opens the ${item.label} page.` : `Opens ${item.label} in its ${what.toLowerCase()} page.`}
      </p>
      {(item.kind === "device" || item.kind === "profile") && (
        <div>
          <Label>Actions</Label>
          <div className="flex items-center gap-2">
            <span title="Coming soon" className="inline-flex">
              <Button size="sm" variant="outline" disabled>
                {item.action}
              </Button>
            </span>
            <span className="font-mono text-muted-foreground text-xs">
              {item.kind}.{item.action.toLowerCase()}
            </span>
            <EffectTag effect="write" />
            <span className="text-muted-foreground text-xs">Coming soon</span>
          </div>
        </div>
      )}
    </>
  );
}
