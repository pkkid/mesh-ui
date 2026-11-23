/**
 * eero's chat reply stream (`PUT /2.2/conversations/messages`): not Server-Sent
 * Events and not one object per line, but complete JSON objects written one
 * after another, with any whitespace between them. Objects are split by
 * brace depth, ignoring braces inside strings. Every object must start with
 * `{`; anything else (an HTML error page) is refused.
 * See docs/eero-api/endpoints.md (Conversations).
 */

import { BackendError } from "../errors";

/** The largest single object accepted. */
export const MAX_OBJECT_CHARS = 1024 * 1024;
/** The largest whole reply accepted. */
export const MAX_STREAM_BYTES = 8 * 1024 * 1024;

const unreadable = () => new BackendError("eero_error", "eero's assistant sent a reply Mesh UI could not read.");

/** Splits text fed in pieces into whole JSON objects. */
export class JsonObjectSplitter {
  private buf = "";
  private depth = 0;
  private quoted = false;
  private escaped = false;

  /** Feeds text; returns each object completed by it, parsed. */
  feed(text: string): unknown[] {
    const out: unknown[] = [];
    for (const c of text) {
      if (this.buf.length === 0) {
        if (/\s/.test(c)) continue;
        if (c !== "{") throw unreadable();
      }
      this.buf += c;
      if (this.buf.length > MAX_OBJECT_CHARS) throw new BackendError("eero_error", "eero's assistant sent a reply that is too large.");
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.quoted = false;
      } else if (c === '"') this.quoted = true;
      else if (c === "{" || c === "[") this.depth++;
      else if (c === "}" || c === "]") this.depth--;
      if (this.depth === 0) {
        try {
          out.push(JSON.parse(this.buf));
        } catch {
          throw unreadable();
        }
        this.buf = "";
      }
    }
    return out;
  }

  /** The stream ended: an object cut off part way is an error. */
  finish(): void {
    if (this.buf.length) throw new BackendError("network_error", "eero's reply was cut off.");
  }
}

/** Reads a response body as a stream of JSON objects, calling `onObject` for each. Stops early when `signal` aborts. */
export async function readJsonObjects(body: ReadableStream<Uint8Array> | null, onObject: (o: unknown) => void, signal?: AbortSignal): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", stop, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const split = new JsonObjectSplitter();
  let size = 0;
  try {
    for (;;) {
      if (signal?.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal?.aborted) return;
        throw new BackendError("network_error", "The connection to eero dropped during the reply.");
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_STREAM_BYTES) throw new BackendError("eero_error", "eero's assistant sent a reply that is too large.");
      let text: string;
      try {
        text = decoder.decode(chunk.value, { stream: true });
      } catch {
        throw unreadable();
      }
      for (const o of split.feed(text)) {
        onObject(o);
        if (signal?.aborted) return;
      }
    }
    if (!signal?.aborted) split.finish();
  } finally {
    signal?.removeEventListener("abort", stop);
    // Done, failed or stopped early: let go of the connection either way.
    stop();
  }
}
