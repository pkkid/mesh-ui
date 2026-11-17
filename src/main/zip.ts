/**
 * A minimal, defensive zip reader for VS Code extension packages (.vsix).
 * Reads the central directory and inflates single entries on demand with
 * Node's zlib, so nothing is unpacked that is not asked for, and every
 * entry has a hard output limit (`maxOutputLength`) that a lying header
 * cannot get around. No zip64, no encryption: theme packages never need them.
 */
import { inflateRawSync } from "node:zlib";

export type ZipLimits = {
  /** Most entries the directory may list. */
  maxEntries: number;
  /** Most bytes all extracted entries may add up to. */
  maxTotalBytes: number;
  /** Highest declared uncompressed / compressed ratio. */
  maxRatio: number;
};

type Entry = { method: number; compressedSize: number; size: number; localOffset: number };

export type ZipReader = {
  names(): string[];
  has(name: string): boolean;
  /** The entry's bytes, at most `maxBytes`. Throws when it is missing, larger, or malformed. */
  read(name: string, maxBytes: number): Buffer;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function openZip(bytes: Buffer, limits: ZipLimits): ZipReader {
  const fail = (why: string): never => {
    throw new Error(`The extension package is not a valid zip (${why}).`);
  };
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("no directory");
  const count = bytes.readUInt16LE(eocd + 10);
  const dirOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) fail("zip64");
  if (count > limits.maxEntries) throw new Error("The extension package has too many files.");

  const entries = new Map<string, Entry>();
  let at = dirOffset;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL) fail("bad directory entry");
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    // Encrypted entries and unknown methods are skipped, not read.
    if (flags & 1 || (method !== 0 && method !== 8) || name.endsWith("/")) continue;
    entries.set(name, { method, compressedSize, size, localOffset });
  }

  let extracted = 0;
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read(name, maxBytes) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`The extension package has no ${name}.`);
      if (entry.size > maxBytes) throw new Error(`${name} is too large.`);
      if (entry.compressedSize > 0 && entry.size / entry.compressedSize > limits.maxRatio) {
        throw new Error(`${name} is compressed suspiciously well.`);
      }
      if (extracted + entry.size > limits.maxTotalBytes) throw new Error("The extension package is too large.");
      const local = entry.localOffset;
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL) fail("bad file header");
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const end = start + entry.compressedSize;
      if (end > bytes.length) fail("truncated");
      const raw = bytes.subarray(start, end);
      let out: Buffer;
      try {
        out = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: maxBytes });
      } catch {
        throw new Error(`${name} could not be unpacked.`);
      }
      if (out.length > maxBytes || out.length !== entry.size) fail("size mismatch");
      extracted += out.length;
      return out;
    },
  };
}
