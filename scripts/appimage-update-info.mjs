#!/usr/bin/env node
/**
 * Embeds update information in each AppImage for AppImage managers such as
 * Gear Lever (docs/platform/build-and-release.md#appimage-update-information).
 *
 *   node scripts/appimage-update-info.mjs <dir>
 *
 * For every *.AppImage directly in <dir>:
 * 1. Writes `gh-releases-zsync|pkkid|mesh-ui|latest|Mesh-UI-*-<arch>.AppImage.zsync`
 *    into the runtime's empty 1 KB `.upd_info` ELF section, in place, so the
 *    file size does not change.
 * 2. Swaps the AppImage's old sha512 for the new one in the latest*.yml and
 *    beta*.yml update files, so electron-updater still accepts the download.
 *    The embedded blockmap is left as built; the string is the same in every
 *    release, so differential downloads still rebuild the right bytes (and a
 *    mismatch would only fall back to a full download).
 * 3. Runs `zsyncmake` to write <name>.AppImage.zsync next to it. Gear Lever
 *    finds the release asset through the .zsync and compares its SHA-1.
 *
 * Run it after electron-builder and before anything hashes the release
 * (checksums.mjs). Running it twice is safe: an AppImage that already holds
 * the string is skipped.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { basename, join } from "node:path";

const OWNER = "pkkid";
const REPO = "mesh-ui";

/** Offset and size of a named section in a little-endian ELF64 file. */
function findSection(fd, name) {
  const header = Buffer.alloc(64);
  readSync(fd, header, 0, 64, 0);
  if (header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2 || header[5] !== 1) {
    throw new Error("not a little-endian ELF64 file");
  }
  const shoff = Number(header.readBigUInt64LE(0x28));
  const shentsize = header.readUInt16LE(0x3a);
  const shnum = header.readUInt16LE(0x3c);
  const shstrndx = header.readUInt16LE(0x3e);
  const table = Buffer.alloc(shentsize * shnum);
  readSync(fd, table, 0, table.length, shoff);
  const at = (i) => ({
    name: table.readUInt32LE(i * shentsize),
    offset: Number(table.readBigUInt64LE(i * shentsize + 0x18)),
    size: Number(table.readBigUInt64LE(i * shentsize + 0x20)),
  });
  const strtab = at(shstrndx);
  const names = Buffer.alloc(strtab.size);
  readSync(fd, names, 0, strtab.size, strtab.offset);
  for (let i = 0; i < shnum; i++) {
    const s = at(i);
    const end = names.indexOf(0, s.name);
    if (names.toString("utf8", s.name, end) === name) return s;
  }
  throw new Error(`no ${name} section`);
}

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("Usage: node scripts/appimage-update-info.mjs <dir>\n");
  process.exit(2);
}

const files = readdirSync(dir).filter((n) => n.endsWith(".AppImage"));
if (files.length === 0) {
  process.stderr.write(`No AppImage in ${dir}\n`);
  process.exit(1);
}
const updateFiles = readdirSync(dir).filter((n) => /^(latest|beta).*\.yml$/.test(n));

for (const name of files) {
  const file = join(dir, name);
  const arch = /^Mesh-UI-.+-([^-]+)\.AppImage$/.exec(name)?.[1];
  if (!arch) throw new Error(`unexpected AppImage name ${name}`);
  const info = `gh-releases-zsync|${OWNER}|${REPO}|latest|Mesh-UI-*-${arch}.AppImage.zsync`;

  const fd = openSync(file, "r+");
  try {
    const section = findSection(fd, ".upd_info");
    const current = Buffer.alloc(section.size);
    readSync(fd, current, 0, section.size, section.offset);
    const text = current.toString("utf8").replace(/\0+$/, "");
    if (text === info) {
      process.stdout.write(`${name}: already has update information\n`);
      continue;
    }
    if (text !== "") throw new Error(`${name}: .upd_info already holds "${text}"`);
    const bytes = Buffer.alloc(section.size);
    if (Buffer.byteLength(info) >= section.size) throw new Error("update information too long");
    bytes.write(info, "utf8");
    const before = sha512(file);
    writeSync(fd, bytes, 0, bytes.length, section.offset);
    closeSync(fd);
    const after = sha512(file);

    let swapped = 0;
    for (const yml of updateFiles) {
      const path = join(dir, yml);
      const body = readFileSync(path, "utf8");
      if (!body.includes(before)) continue;
      writeFileSync(path, body.split(before).join(after));
      swapped++;
    }
    if (updateFiles.length > 0 && swapped === 0) {
      throw new Error(`${name}: no update file lists its sha512`);
    }
    process.stdout.write(`${name}: ${info} (sha512 updated in ${swapped} update file(s))\n`);
  } finally {
    try {
      closeSync(fd);
    } catch {
      // already closed after the write
    }
  }

  execFileSync("zsyncmake", ["-u", name, "-o", `${name}.zsync`, name], { cwd: dir, stdio: "inherit" });
  process.stdout.write(`${basename(file)}.zsync written\n`);
}
