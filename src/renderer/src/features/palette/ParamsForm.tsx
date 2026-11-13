/**
 * The params form in the palette preview, generated from a command's JSON
 * Schema (search.ts `paramFields`): entity pickers for ref params, segmented
 * controls for small enums and optional booleans, selects for larger enums,
 * text and number inputs otherwise. Field messages come from zod
 * (`validateParams`), the same text `bad_params` returns.
 */
import { useState } from "react";

import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import type { ParamField, RefKind } from "./search";

/** One choice in an entity picker: the value sent (a name, as the CLI would) and a context hint. */
export type EntityOption = { value: string; label: string; hint: string | null };
export type EntityOptions = Partial<Record<RefKind, ReadonlyArray<EntityOption>>>;

type Props = {
  fields: ReadonlyArray<ParamField>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  errors: Record<string, string>;
  entities: EntityOptions;
  disabled?: boolean;
};

const CONTROL =
  "h-[30px] w-full min-w-0 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64 aria-invalid:border-destructive/50 dark:bg-input/32";

/** Optional fields shown before "N more params"; required and filled-in fields always show. */
const FIRST_OPTIONAL = 4;

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** Sentinel for "no value" in selects and segmented controls. */
const UNSET = "__unset";
const NULL = "__null";

export function ParamsForm({ fields, values, onChange, errors, entities, disabled }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (fields.length === 0) return <p className="text-muted-foreground text-xs">No params.</p>;
  let optional = 0;
  const visible = fields.filter((f) => {
    if (showAll || f.required || values[f.name] !== undefined || errors[f.name]) return true;
    optional += 1;
    return optional <= FIRST_OPTIONAL;
  });
  const hidden = fields.length - visible.length;
  const set = (name: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined) delete next[name];
    else next[name] = value;
    onChange(next);
  };

  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 text-[12.5px]">
      {visible.map((f) => {
        const id = `palette-param-${f.name}`;
        const error = errors[f.name];
        return (
          <div key={f.name} className="contents">
            <label htmlFor={id} title={f.description ?? undefined} className="truncate pt-[7px] font-mono text-[11.5px] text-foreground/80">
              {f.name}
              {f.required && <span className="text-destructive-foreground">*</span>}
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              <FieldControl
                id={id}
                field={f}
                value={values[f.name]}
                onChange={(v) => set(f.name, v)}
                entities={entities}
                invalid={!!error}
                disabled={disabled}
              />
              {error ? (
                <span className="text-[11px] text-destructive-foreground">{error}</span>
              ) : (
                f.kind !== "ref" &&
                f.description && <span className="truncate text-[11px] text-muted-foreground">{f.description}</span>
              )}
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="col-start-2 cursor-pointer justify-self-start rounded-sm text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {hidden} more {hidden === 1 ? "param" : "params"}
        </button>
      )}
    </div>
  );
}

type ControlProps = {
  id: string;
  field: ParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  entities: EntityOptions;
  invalid: boolean;
  disabled?: boolean;
};

function FieldControl({ id, field: f, value, onChange, entities, invalid, disabled }: ControlProps) {
  const common = {
    id,
    "aria-invalid": invalid || undefined,
    disabled,
  };

  if (f.kind === "ref") {
    const options = (f.refKind && entities[f.refKind]) || [];
    const current = value === null ? NULL : typeof value === "string" ? value : UNSET;
    const hint = options.find((o) => o.value === value)?.hint;
    // A typed value that is not in the list (an id) stays selectable.
    const extra = typeof value === "string" && !options.some((o) => o.value === value) ? value : null;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <select
          {...common}
          value={current}
          onChange={(e) => onChange(e.target.value === UNSET ? undefined : e.target.value === NULL ? null : e.target.value)}
          className={cn(CONTROL, "cursor-pointer")}
        >
          <option value={UNSET}>{f.required ? `Choose ${article(f.refKind ?? "value")}` : "-"}</option>
          {f.nullable && <option value={NULL}>None (null)</option>}
          {extra && <option value={extra}>{extra}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    );
  }

  if (f.kind === "enum" && f.segmented) {
    const opts = [...(f.required || f.default !== undefined ? [] : [{ value: UNSET, label: "Any" }]), ...f.options.map((o) => ({ value: o, label: o }))];
    return (
      <Segmented
        aria-label={f.name}
        value={typeof value === "string" ? value : UNSET}
        onValueChange={(v) => onChange(v === UNSET ? undefined : v)}
        options={opts.map((o) => ({ ...o, disabled }))}
        className="max-w-full self-start overflow-x-auto"
      />
    );
  }

  if (f.kind === "boolean") {
    const opts = [...(f.required ? [] : [{ value: UNSET, label: "Any" }]), { value: "true", label: "true" }, { value: "false", label: "false" }];
    return (
      <Segmented
        aria-label={f.name}
        value={value === true ? "true" : value === false ? "false" : UNSET}
        onValueChange={(v) => onChange(v === UNSET ? undefined : v === "true")}
        options={opts.map((o) => ({ ...o, disabled }))}
        className="self-start"
      />
    );
  }

  if (f.kind === "enum") {
    return (
      <select
        {...common}
        value={typeof value === "string" ? value : UNSET}
        onChange={(e) => onChange(e.target.value === UNSET ? undefined : e.target.value)}
        className={cn(CONTROL, "cursor-pointer")}
      >
        {!f.required && <option value={UNSET}>-</option>}
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (f.kind === "integer" || f.kind === "number") {
    return (
      <input
        {...common}
        type="number"
        inputMode={f.kind === "integer" ? "numeric" : "decimal"}
        min={f.min ?? undefined}
        max={f.max ?? undefined}
        placeholder={f.default !== undefined ? String(f.default) : "-"}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={cn(CONTROL, "tabular-nums")}
      />
    );
  }

  if (f.kind === "list") {
    // Comma separated; each part is one array item.
    const text = Array.isArray(value) ? value.join(", ") : "";
    return (
      <input
        {...common}
        type="text"
        placeholder={f.options.length ? f.options.slice(0, 3).join(", ") : "-"}
        defaultValue={text}
        onChange={(e) => {
          const parts = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parts.length ? parts : undefined);
        }}
        className={CONTROL}
      />
    );
  }

  return (
    <input
      {...common}
      type="text"
      placeholder={f.default !== undefined ? String(f.default) : "-"}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className={CONTROL}
    />
  );
}
