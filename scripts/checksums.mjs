#!/usr/bin/env node
/**
 * Writes SHA256SUMS.txt for a release (docs/platform/build-and-release.md#ci).
 *
 *   node scripts/checksums.mjs <dir>
 *
 * Hashes every file directly in <dir> (not subfolders, not an existing
 * SHA256SUMS.txt) and writes <dir>/SHA256SUMS.txt in the `sha256sum` format,
 * `<hex>  <name>`, sorted by name, so `sha256sum -c SHA256SUMS.txt` checks
 * the downloads. Prints the file too.
 */

import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "SHA256SUMS.txt";

function sha256(file) {
  return new Promise((done, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => done(hash.digest("hex")));
  });
}

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("Usage: node scripts/checksums.mjs <dir>\n");
  process.exit(2);
}

const names = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name !== OUT)
  .map((e) => e.name)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
if (names.length === 0) {
  process.stderr.write(`No files to hash in ${dir}\n`);
  process.exit(1);
}

let text = "";
for (const name of names) text += `${await sha256(join(dir, name))}  ${name}\n`;
writeFileSync(join(dir, OUT), text);
process.stdout.write(text);
