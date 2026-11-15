#!/usr/bin/env node
/**
 * Release notes for the draft release (docs/platform/build-and-release.md#ci).
 *
 *   node scripts/release-notes.mjs [docs/reviews/M<n>.md]
 *
 * Prints section 4, "What changed for a user", of the given milestone review
 * (default: the highest-numbered docs/reviews/M<n>.md), followed by fixed
 * lines on the unsigned macOS and Windows builds and SHA256SUMS.txt. The
 * maintainer edits the draft before publishing if needed (a patch release,
 * say).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXED = `## Downloads

- **macOS** builds are not signed or notarized yet. On first launch macOS
  says it cannot verify Mesh UI: try to open it once, then open **System
  Settings > Privacy & Security** and click **Open Anyway**. Or run
  \`xattr -d com.apple.quarantine "/Applications/Mesh UI.app"\`.
- **Windows** builds are not signed yet. On first run SmartScreen says
  "Windows protected your PC"; click **More info**, then **Run anyway**.
- **Checksums:** \`SHA256SUMS.txt\` lists the SHA-256 of every file in this
  release. Check a download with \`sha256sum -c SHA256SUMS.txt --ignore-missing\`
  (Linux), \`shasum -a 256 -c SHA256SUMS.txt --ignore-missing\` (macOS) or
  \`Get-FileHash <file>\` (Windows PowerShell).
`;

function latestReview() {
  const dir = join(root, "docs/reviews");
  const reviews = readdirSync(dir)
    .map((name) => ({ name, n: Number(/^M(\d+)\.md$/.exec(name)?.[1]) }))
    .filter((r) => Number.isInteger(r.n))
    .sort((a, b) => b.n - a.n);
  if (reviews.length === 0) throw new Error(`No docs/reviews/M<n>.md in ${dir}`);
  return join(dir, reviews[0].name);
}

/** The body of "## 4. What changed for a user", up to the next ## heading. */
function section4(markdown, file) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+4\.\s+What changed for a user\s*$/i.test(l));
  if (start === -1) throw new Error(`${file} has no "## 4. What changed for a user" section`);
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (!body) throw new Error(`${file}: section 4 is empty`);
  return body;
}

const file = resolve(process.argv[2] ?? latestReview());
try {
  const body = section4(readFileSync(file, "utf8"), file);
  process.stdout.write(`## What changed\n\n${body}\n\n${FIXED}`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
