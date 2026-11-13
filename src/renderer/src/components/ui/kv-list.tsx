// Key-value list for info cards (docs/design/design-system.md, Components):
// two columns, muted keys, values in tabular-nums. Addresses (IP, MAC,
// serial) use `mono`, and `copy` adds a small button that copies the value.
import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { MISSING } from "../../../../core/format";

export type KvItem = {
  label: string;
  /** Shown as is; `null`, `undefined` or "" shows "-". */
  value: ReactNode;
  mono?: boolean;
  /** The text to copy; defaults to `value` when it is a string. */
  copy?: boolean | string;
};

function KvList({ items, className }: { items: ReadonlyArray<KvItem>; className?: string }) {
  return (
    <dl data-slot="kv-list" className={cn("grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]", className)}>
      {items.map((item) => {
        const missing = item.value === null || item.value === undefined || item.value === "";
        const text = typeof item.copy === "string" ? item.copy : typeof item.value === "string" ? item.value : null;
        return (
          <div key={item.label} className="contents">
            <dt className="truncate text-muted-foreground">{item.label}</dt>
            <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right tabular-nums">
              <span className={cn("truncate", item.mono && "font-mono text-xs", missing && "text-muted-foreground")}>
                {missing ? MISSING : item.value}
              </span>
              {item.copy && !missing && text && <CopyButton text={text} label={item.label} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A tiny ghost button that copies `text` and shows a check for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        void copyText(text).then((ok) => ok && setCopied(true));
      }}
    >
      <Icon className="size-3" />
    </button>
  );
}

/**
 * Copies text. The app denies web permission checks (src/main/index.ts), which
 * can refuse the async Clipboard API, so fall back to a selected textarea and
 * `execCommand("copy")`, which needs only the click's user gesture.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.append(el);
    el.select();
    try {
      return document.execCommand("copy");
    } finally {
      el.remove();
    }
  }
}

export { KvList };
