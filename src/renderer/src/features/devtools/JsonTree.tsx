/**
 * A collapsible, highlighted JSON view for the dev tools panel. Ported from
 * the JSON Formatter extension (Copyright (c) 2023, Callum Locke,
 * BSD-3-Clause: https://github.com/callumlocke/json-formatter/blob/master/LICENSE):
 * the tree is built once with plain DOM calls, not React elements, so a
 * 256 KB response renders fast, and every entry uses `content-visibility:
 * auto` so offscreen ones cost nothing to paint. Clicking an arrow collapses
 * or expands that block; Ctrl or Cmd+click does its siblings too. Styles are
 * `.json-tree` in index.css. Text not JSON falls back to a plain block.
 */
import { useEffect, useRef } from "react";

const span = (className?: string, text?: string): HTMLSpanElement => {
  const el = document.createElement("span");
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** One value; `key` is undefined for array items and the root. */
function renderEntry(value: unknown, key?: string): HTMLSpanElement {
  const isArray = Array.isArray(value);
  const isBlock = typeof value === "object" && value !== null;
  const keys = isBlock ? Object.keys(value as object) : [];
  const entry = span("entry");
  if (keys.length) entry.appendChild(span("e"));
  if (key !== undefined) entry.append('"', span("k", JSON.stringify(key).slice(1, -1)), '"', ": ");
  if (isBlock) {
    entry.appendChild(span("b", isArray ? "[" : "{"));
    if (keys.length) {
      const inner = span("blockInner");
      keys.forEach((k, i) => {
        const child = renderEntry((value as Record<string, unknown>)[k], isArray ? undefined : k);
        if (i < keys.length - 1) child.append(",");
        inner.appendChild(child);
      });
      entry.append(span("ell"), inner);
    }
    entry.appendChild(span("b", isArray ? "]" : "}"));
    entry.dataset.size = ` // ${keys.length} ${keys.length === 1 ? "item" : "items"}`;
  } else if (typeof value === "string") {
    const str = span("s");
    str.append('"', span(undefined, JSON.stringify(value).slice(1, -1)), '"');
    entry.appendChild(str);
  } else if (typeof value === "number") {
    entry.appendChild(span("n", String(value)));
  } else if (typeof value === "boolean") {
    entry.appendChild(span("bl", String(value)));
  } else {
    entry.appendChild(span("nl", "null"));
  }
  return entry;
}

/** The parsed value when `text` is a JSON object or array, else undefined. */
export function parseJsonBlock(text: string | null): unknown {
  if (!text) return undefined;
  const first = text.match(/[^\x20\x0a\x0d\x09]/);
  if (!first || (first[0] !== "{" && first[0] !== "[")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const onMouseDown = (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.className !== "e") return;
  event.preventDefault();
  const entry = target.parentElement;
  if (!entry) return;
  const collapse = !entry.classList.contains("collapsed");
  const entries = event.metaKey || event.ctrlKey ? Array.from(entry.parentElement?.children ?? []) : [entry];
  for (const el of entries) el.classList.toggle("collapsed", collapse);
};

/** A JSON body as a collapsible tree, or the text as is when it is not a JSON object or array. */
export function JsonTree({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const value = parseJsonBlock(text);
    if (value === undefined) {
      el.replaceChildren(span("raw", text || "(empty)"));
      return;
    }
    el.replaceChildren(renderEntry(value));
    el.addEventListener("mousedown", onMouseDown);
    return () => el.removeEventListener("mousedown", onMouseDown);
  }, [text]);
  return <div ref={host} className="json-tree" />;
}
