/**
 * The params form in the palette preview, generated from a command's JSON
 * Schema (search.ts `paramFields`): entity pickers for ref params, segmented
 * controls for small enums and optional booleans, selects for larger enums,
 * text and number inputs otherwise. Field messages come from zod
 * (`validateParams`), the same text `bad_params` returns.
 */
import { useState } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
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
  "h-7 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64 aria-invalid:border-destructive/50 dark:bg-input/32";

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
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-xs">
      {visible.map((f) => {
        const id = `palette-param-${f.name}`;
        const error = errors[f.name];
        return (
          <div key={f.name} className="contents">
            <label htmlFor={id} title={f.description ?? undefined} className="truncate pt-[6px] font-mono text-[11px] text-foreground/80">
              {f.name}
              {f.required && <span className="text-destructive-foreground">*</span>}
            </label>
            {/* The field's help (its `.describe()` text) is a tooltip on its name and its control, not a line under it. */}
            <div className="flex min-w-0 flex-col gap-1" title={f.description ?? undefined}>
              <FieldControl
                id={id}
                field={f}
                value={values[f.name]}
                onChange={(v) => set(f.name, v)}
                entities={entities}
                invalid={!!error}
                disabled={disabled}
              />
              {error && <span className="text-[11px] text-destructive-foreground">{error}</span>}
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

/**
 * Every choice in the form is the app's dropdown (components/ui/select) at its compact `tool` size (28px, 12px text),
 * so the technical form fits more; text fields match it.
 */
function Choice({
  id,
  label,
  value,
  options,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  invalid: boolean;
  disabled?: boolean;
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => v !== null && onChange(v)} disabled={disabled}>
      <SelectTrigger id={id} size="tool" className="w-full min-w-0" aria-label={label} aria-invalid={invalid || undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup className="max-h-[min(300px,var(--available-height))]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
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
        <Choice
          id={id}
          invalid={invalid}
          disabled={disabled}
          label={f.name}
          value={current}
          onChange={(v) => onChange(v === UNSET ? undefined : v === NULL ? null : v)}
          options={[
            { value: UNSET, label: f.required ? `Choose ${article(f.refKind ?? "value")}` : "-" },
            ...(f.nullable ? [{ value: NULL, label: "None (null)" }] : []),
            ...(extra ? [{ value: extra, label: extra }] : []),
            ...options.map((o) => ({ value: o.value, label: o.label })),
          ]}
        />
        {hint && <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    );
  }

  // Choices are dropdowns (design-system.md, Buttons and links: dropdowns, not pill toggles).
  if ((f.kind === "enum" && f.segmented) || f.kind === "boolean") {
    const opts =
      f.kind === "boolean"
        ? [...(f.required ? [] : [{ value: UNSET, label: "Any" }]), { value: "true", label: "true" }, { value: "false", label: "false" }]
        : [...(f.required || f.default !== undefined ? [] : [{ value: UNSET, label: "Any" }]), ...f.options.map((o) => ({ value: o, label: o }))];
    const current = f.kind === "boolean" ? (value === true ? "true" : value === false ? "false" : UNSET) : typeof value === "string" ? value : UNSET;
    return (
      <Choice
        id={id}
        invalid={invalid}
        disabled={disabled}
        label={f.name}
        value={current}
        onChange={(v) => onChange(v === UNSET ? undefined : f.kind === "boolean" ? v === "true" : v)}
        options={opts}
      />
    );
  }

  if (f.kind === "enum") {
    return (
      <Choice
        id={id}
        invalid={invalid}
        disabled={disabled}
        label={f.name}
        value={typeof value === "string" ? value : UNSET}
        onChange={(v) => onChange(v === UNSET ? undefined : v)}
        options={[...(f.required ? [] : [{ value: UNSET, label: "-" }]), ...f.options.map((o) => ({ value: o, label: o }))]}
      />
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
