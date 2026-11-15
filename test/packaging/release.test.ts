/**
 * The release workflow (docs/platform/build-and-release.md#ci):
 * scripts/checksums.mjs and scripts/release-notes.mjs run for real on temp
 * files and the M5 review, and .github/workflows/release.yml gets a text
 * check of its triggers, publish flags, secrets and permissions. The
 * workflow itself only runs in GitHub Actions, from a tag or a manual
 * dry run by the maintainer.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

function node(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("scripts/checksums.mjs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mesh-ui-M6.4-sums-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes sorted `sha256  name` lines for every file in the folder", () => {
    const files: Record<string, string> = {
      "mesh-ui_0.6.0_amd64.deb": "deb bytes",
      "Mesh-UI-0.6.0-universal.dmg": "dmg bytes",
      "latest-mac.yml": "version: 0.6.0\n",
      "Mesh-UI-Setup-0.6.0-x64.exe": "",
      "SHA256SUMS.txt": "stale, replaced",
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    mkdirSync(join(dir, "win-unpacked"));
    writeFileSync(join(dir, "win-unpacked", "Mesh UI.exe"), "nested, skipped");

    const r = node("scripts/checksums.mjs", [dir]);
    expect(r.code).toBe(0);
    const written = readFileSync(join(dir, "SHA256SUMS.txt"), "utf8");
    expect(r.stdout).toBe(written);

    const names = Object.keys(files).filter((n) => n !== "SHA256SUMS.txt").sort((a, b) => (a < b ? -1 : 1));
    const expected = names.map((n) => `${createHash("sha256").update(files[n] ?? "").digest("hex")}  ${n}\n`).join("");
    expect(written).toBe(expected);
    for (const line of written.trimEnd().split("\n")) expect(line).toMatch(/^[0-9a-f]{64}  \S/);
  });

  it("fails on an empty folder and without an argument", () => {
    expect(node("scripts/checksums.mjs", [dir]).code).toBe(1);
    expect(node("scripts/checksums.mjs", []).code).toBe(2);
  });
});

describe("scripts/release-notes.mjs", () => {
  it("prints only section 4 of the M5 review plus the fixed lines", () => {
    const r = node("scripts/release-notes.mjs", ["docs/reviews/M5.md"]);
    expect(r.code).toBe(0);

    const review = read("docs/reviews/M5.md");
    const start = review.indexOf("## 4. What changed for a user\n");
    const end = review.indexOf("\n## 5.", start);
    expect(start).toBeGreaterThan(-1);
    const body = review.slice(start, end).replace("## 4. What changed for a user\n", "").trim();

    const [notes, fixed] = r.stdout.split("\n## Downloads\n");
    expect(notes).toBe(`## What changed\n\n${body}\n`);
    // Nothing from the other sections.
    for (const heading of ["## 1.", "## 2.", "## 3.", "## 5.", "## 6.", "## Manual checks"]) expect(r.stdout).not.toContain(heading);
    expect(fixed).toContain("Windows** builds are not signed yet");
    expect(fixed).toContain("More info");
    expect(fixed).toContain("SHA256SUMS.txt");
    expect(fixed).toContain("sha256sum -c SHA256SUMS.txt");
  });

  it("defaults to the highest-numbered review", () => {
    const r = node("scripts/release-notes.mjs", []);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("## What changed\n\n")).toBe(true);
  });

  it("fails on a review with no section 4", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesh-ui-M6.4-notes-"));
    try {
      const file = join(dir, "M9.md");
      writeFileSync(file, "# M9 review\n\n## 3. Acceptance\n\nok\n");
      const r = node("scripts/release-notes.mjs", [file]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("What changed for a user");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe(".github/workflows/release.yml", () => {
  const yml = read(".github/workflows/release.yml");
  const lines = yml.split("\n").filter((l) => !/^\s*#/.test(l));

  /** The lines of a top-level key's block, up to the next top-level key. */
  function topBlock(key: string): string[] {
    const start = lines.findIndex((l) => l === `${key}:`);
    expect(start, `top-level ${key}:`).toBeGreaterThan(-1);
    const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
    return lines.slice(start + 1, end === -1 ? lines.length : end).filter((l) => l.trim() !== "");
  }

  /** Each job's lines, keyed by job id. */
  function jobs(): Record<string, string> {
    const out: Record<string, string> = {};
    let id = "";
    for (const l of topBlock("jobs")) {
      const m = /^ {2}([\w-]+):\s*$/.exec(l);
      if (m) id = m[1] ?? "";
      else if (id) out[id] = `${out[id] ?? ""}${l}\n`;
    }
    return out;
  }

  it("triggers only on v* tags and a manual run with a dry_run input", () => {
    const on = topBlock("on");
    const events = on.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*/, ""));
    expect(events).toEqual(["push", "workflow_dispatch"]);
    const push = on.join("\n").split("workflow_dispatch:")[0];
    expect(push).toMatch(/tags: \["v\*"\]/);
    expect(push).not.toMatch(/branches|paths/);
    const dispatch = on.join("\n").split("workflow_dispatch:")[1];
    expect(dispatch).toMatch(/dry_run:[\s\S]*type: boolean[\s\S]*default: true/);
  });

  it("has the four jobs (linux a two-arch matrix) and publishes only from a tag, never on a dry run", () => {
    const j = jobs();
    expect(Object.keys(j)).toEqual(["mac", "win", "linux", "publish"]);
    expect(j.linux).toMatch(/runner: ubuntu-latest/);
    expect(j.linux).toMatch(/runner: ubuntu-24\.04-arm/);
    expect(j.linux).toMatch(/name: linux-\$\{\{ matrix\.arch \}\}/);
    expect(j.publish).toMatch(/needs: \[mac, win, linux\]/);
    expect(j.publish).toContain("if: startsWith(github.ref, 'refs/tags/v') && (github.event_name == 'push' || !inputs.dry_run)");
  });

  it("builds with --publish never everywhere", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const s of ["dist", "dist:dir"]) expect(pkg.scripts[s]).toMatch(/electron-builder@[\d.]+ .*--publish never/);
    const builds = lines.filter((l) => /run: pnpm dist(:dir)?\b(?!:)/.test(l));
    expect(builds.length).toBe(6);
    for (const l of builds) expect(l).not.toMatch(/--publish/);
    // No direct electron-builder call could publish on its own.
    const code = lines.join("\n");
    expect(code).not.toMatch(/electron-builder/);
    expect(code).not.toMatch(/--publish (always|onTag|onTagOrDraft)/);
  });

  it("keeps the signing secrets in the release environment of the mac job only", () => {
    const j = jobs();
    expect(j.mac).toMatch(/^ {4}environment: release$/m);
    for (const id of ["win", "linux", "publish"]) {
      expect(j[id]).not.toMatch(/environment:/);
      expect(j[id]).not.toMatch(/secrets\./);
    }
    for (const s of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
      expect(j.mac).toContain(`secrets.${s} }}`);
    }
    // electron-builder wants a path for APPLE_API_KEY: decoded to a temp file.
    expect(j.mac).toMatch(/base64 --decode > "\$key"/);
    expect(j.mac).toContain('echo "APPLE_API_KEY=$key" >> "$GITHUB_ENV"');
    expect(yml).not.toMatch(/pull_request/);
  });

  it("grants contents: write only to publish", () => {
    expect(topBlock("permissions").map((l) => l.trim())).toEqual(["contents: read"]);
    const j = jobs();
    expect(j.publish).toMatch(/permissions:\n\s+contents: write/);
    expect(yml.match(/contents: write/g)).toHaveLength(1);
    for (const id of ["mac", "win", "linux"]) expect(j[id]).not.toMatch(/permissions:/);
  });

  it("creates a draft release with gh, a pre-release for a -suffix tag", () => {
    const j = jobs();
    expect(j.publish).toMatch(/gh release create "\$TAG" release\/\* --draft/);
    expect(j.publish).toContain('if [[ "$TAG" == *-* ]]; then prerelease=(--prerelease); fi');
    expect(j.publish).toContain("node scripts/checksums.mjs release");
    expect(j.publish).toContain("node scripts/release-notes.mjs");
    expect(j.publish).toContain('if [ "$TAG" != "v$version" ]');
  });

  it("runs dist:smoke and one ui:shot of the overview per OS and uploads it", () => {
    const j = jobs();
    for (const id of ["mac", "win", "linux"]) {
      const steps = j[id] ?? "";
      const dir = steps.search(/run: pnpm dist:dir/);
      const smoke = steps.indexOf("run: pnpm dist:smoke");
      const shot = steps.search(/run: pnpm ui:shot --route '#\/overview'/);
      expect(dir, id).toBeGreaterThan(-1);
      expect(smoke, id).toBeGreaterThan(dir);
      expect(shot, id).toBeGreaterThan(smoke);
      expect(steps, id).toMatch(/name: ui-shot-/);
    }
  });

  it("pins actions like ci.yml", () => {
    const ci = read(".github/workflows/ci.yml");
    const uses = (text: string) => [...text.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1] ?? "");
    for (const u of uses(yml)) expect(u).toMatch(/^[\w-]+\/[\w-]+@v\d+$/);
    const ciUses = new Set(uses(ci));
    for (const u of uses(yml)) {
      const name = u.split("@")[0];
      const inCi = [...ciUses].find((c) => c.startsWith(`${name}@`));
      if (inCi) expect(u).toBe(inCi);
    }
  });
});
