/**
 * A small Markdown renderer for eero's assistant replies: paragraphs, line
 * breaks, `-` and `1.` lists, `#` headings, fenced code, and inline bold,
 * italic, code and links. It builds React elements, never HTML strings, so
 * nothing in a reply can inject markup. Links open outside the app, https only.
 */
import type { ReactNode } from "react";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: "h", text: heading[1] ?? "" });
      i++;
      continue;
    }
    const listKind = /^\s*[-*•]\s+/.test(line) ? "ul" : /^\s*\d+[.)]\s+/.test(line) ? "ol" : null;
    if (listKind) {
      const items: string[] = [];
      const marker = listKind === "ul" ? /^\s*[-*•]\s+/ : /^\s*\d+[.)]\s+/;
      while (i < lines.length && marker.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(marker, ""));
        i++;
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? "") && !marker.test(lines[i] ?? "")) items[items.length - 1] += ` ${(lines[i++] ?? "").trim()}`;
      }
      out.push({ kind: listKind, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^\s*([-*•]\s+|\d+[.)]\s+|#{1,6}\s+|```)/.test(lines[i] ?? "")) para.push(lines[i++] ?? "");
    if (!para.length) para.push(lines[i++] ?? "");
    out.push({ kind: "p", lines: para });
  }
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}.${i}`;
    if (/^(\*\*|__).+\1$/.test(part)) return <strong key={k} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      return href?.startsWith("https://") ? (
        <a key={k} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {label}
        </a>
      ) : (
        label
      );
    }
    if (/^([*_]).+\1$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/** Renders `text` as Markdown blocks. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        const key = String(i);
        switch (b.kind) {
          case "h":
            return <p key={key} className="font-semibold">{inline(b.text, key)}</p>;
          case "code":
            return <pre key={key} className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">{b.text}</pre>;
          case "ul":
            return <ul key={key} className="list-disc space-y-1 ps-5">{b.items.map((it, j) => <li key={`${key}.${j}`}>{inline(it, `${key}.${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={key} className="list-decimal space-y-1 ps-5">{b.items.map((it, j) => <li key={`${key}.${j}`}>{inline(it, `${key}.${j}`)}</li>)}</ol>;
          default:
            return (
              <p key={key}>
                {b.lines.map((l, j) => (
                  <span key={`${key}.${j}`}>
                    {j > 0 && <br />}
                    {inline(l, `${key}.${j}`)}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
