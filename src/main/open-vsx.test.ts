import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createOpenVsx, packagePath, trustedUrl, type FetchLike } from "./open-vsx";
import { openZip } from "./zip";

/** A plain zip (deflate) built by hand, enough for the reader. */
function makeZip(files: Record<string, string | Buffer>, opts: { lieAboutSize?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const size = opts.lieAboutSize === name ? 10 : data.length;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const LIMITS = { maxEntries: 100, maxTotalBytes: 1_000_000, maxRatio: 200 };

describe("openZip", () => {
  it("reads entries on demand", () => {
    const zip = openZip(makeZip({ "extension/a.json": "hello", "extension/b.json": "world" }), LIMITS);
    expect(zip.names()).toEqual(["extension/a.json", "extension/b.json"]);
    expect(zip.read("extension/b.json", 100).toString()).toBe("world");
    expect(() => zip.read("missing", 100)).toThrow(/no missing/);
  });

  it("refuses entries over the limit, even when the header lies", () => {
    const big = "x".repeat(5000);
    expect(() => openZip(makeZip({ a: big }), LIMITS).read("a", 100)).toThrow(/too large/);
    expect(() => openZip(makeZip({ a: big }, { lieAboutSize: "a" }), LIMITS).read("a", 100)).toThrow(/could not be unpacked|size mismatch/);
  });

  it("refuses zip bombs and too many entries", () => {
    expect(() => openZip(makeZip({ a: "y".repeat(500_000) }), LIMITS).read("a", 600_000)).toThrow(/suspiciously/);
    expect(() => openZip(makeZip({ a: "1", b: "2" }), { ...LIMITS, maxEntries: 1 })).toThrow(/too many/);
    expect(() => openZip(Buffer.from("not a zip at all, sorry"), LIMITS)).toThrow(/not a valid zip/);
  });
});

describe("paths and URLs", () => {
  it("keeps theme paths inside the package", () => {
    expect(packagePath("./themes/dark.json", "extension/package.json")).toBe("extension/themes/dark.json");
    expect(packagePath("base.json", "extension/themes/dark.json")).toBe("extension/themes/base.json");
    expect(packagePath("../../etc/passwd", "extension/package.json")).toBeNull();
    expect(packagePath("/abs.json", "extension/package.json")).toBeNull();
    expect(packagePath("C:\\x.json", "extension/package.json")).toBeNull();
  });

  it("only trusts https open-vsx.org", () => {
    expect(trustedUrl("https://open-vsx.org/api/x")).toBe("https://open-vsx.org/api/x");
    expect(trustedUrl("http://open-vsx.org/api/x")).toBeNull();
    expect(trustedUrl("https://open-vsx.org.evil.example/x")).toBeNull();
    expect(trustedUrl("https://user:pw@open-vsx.org/x")).toBeNull();
  });
});

// An invented extension with a light and dark theme; the dark one uses an include.
const manifest = {
  name: "sample-theme",
  license: "MIT",
  contributes: {
    themes: [
      { label: "Sample Light", uiTheme: "vs", path: "./themes/light.json" },
      { label: "Sample Dark", uiTheme: "vs-dark", path: "./themes/dark.json" },
    ],
  },
};
const vsix = makeZip({
  "extension/package.json": JSON.stringify(manifest),
  "extension/themes/light.json": JSON.stringify({ type: "light", colors: { "editor.background": "#fafafa" } }),
  "extension/themes/base.json": JSON.stringify({ colors: { "editor.background": "#101010", "editor.foreground": "#eeeeee" } }),
  "extension/themes/dark.json": `// comment\n{ "include": "./base.json", "type": "dark", "colors": { "editor.background": "#141414", "x.unused": "#fff" }, }`,
});

function fakeRegistry(overrides: { license?: string; sha?: string; vsix?: Buffer; themes?: unknown[] } = {}) {
  const body = overrides.vsix ?? vsix;
  const files = {
    manifest: "https://open-vsx.org/api/sample/sample-theme/1.0.0/file/package.json",
    download: "https://open-vsx.org/api/sample/sample-theme/1.0.0/file/sample.vsix",
    sha256: "https://open-vsx.org/api/sample/sample-theme/1.0.0/file/sample.sha256",
  };
  const requests: string[] = [];
  const routes: Record<string, string | Buffer> = {
    [files.manifest]: JSON.stringify({ ...manifest, license: overrides.license ?? "MIT", contributes: { themes: overrides.themes ?? manifest.contributes.themes } }),
    [files.download]: body,
    [files.sha256]: overrides.sha ?? `${createHash("sha256").update(body).digest("hex")}  sample.vsix`,
    "https://open-vsx.org/api/sample/sample-theme": JSON.stringify({
      namespace: "sample",
      name: "sample-theme",
      displayName: "Sample Theme",
      description: "A theme",
      version: "1.0.0",
      license: overrides.license ?? "MIT",
      downloadCount: 42,
      files,
    }),
  };
  const fetch: FetchLike = async (url) => {
    requests.push(url);
    if (url.startsWith("https://open-vsx.org/api/-/search")) {
      return new Response(JSON.stringify({ extensions: [{ namespace: "sample", name: "sample-theme" }, { namespace: "../x", name: "y" }] }));
    }
    const route = routes[url];
    return route === undefined ? new Response("missing", { status: 404 }) : new Response(typeof route === "string" ? route : new Uint8Array(route));
  };
  return { fetch, requests };
}

describe("createOpenVsx", () => {
  it("searches colour themes with a permissive licence", async () => {
    const { fetch, requests } = fakeRegistry();
    const result = await createOpenVsx(fetch).search("sample", "rating");
    expect(result).toEqual({
      ok: true,
      extensions: [expect.objectContaining({ id: "sample.sample-theme", name: "Sample Theme", license: "MIT", themeCount: 2 })],
    });
    const url = new URL(requests[0]!);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ query: "sample", category: "Themes", sortBy: "rating" });
    expect(requests.every((r) => r.startsWith("https://open-vsx.org/"))).toBe(true);
  });

  it("drops extensions with other licences or no colour themes", async () => {
    expect(await createOpenVsx(fakeRegistry({ license: "GPL-3.0" }).fetch).search("", "x")).toEqual({ ok: true, extensions: [] });
    expect(await createOpenVsx(fakeRegistry({ themes: [] }).fetch).search("", "x")).toEqual({ ok: true, extensions: [] });
  });

  it("downloads, verifies and unpacks themes, following includes", async () => {
    const result = await createOpenVsx(fakeRegistry().fetch).download("sample.sample-theme");
    if (!result.ok) throw new Error(result.message);
    expect(result.themes).toEqual([
      { label: "Sample Light", appearance: "light", theme: { type: "light", colors: { "editor.background": "#fafafa" } } },
      {
        label: "Sample Dark",
        appearance: "dark",
        theme: { type: "dark", colors: { "editor.background": "#141414", "editor.foreground": "#eeeeee" } },
      },
    ]);
  });

  it("refuses a package that does not match its checksum", async () => {
    const result = await createOpenVsx(fakeRegistry({ sha: "0".repeat(64) }).fetch).download("sample.sample-theme");
    expect(result).toEqual({ ok: false, message: "The downloaded package does not match its checksum." });
  });

  it("refuses bad ids and other licences", async () => {
    const { fetch, requests } = fakeRegistry({ license: "GPL-3.0" });
    expect(await createOpenVsx(fetch).download("../../etc")).toMatchObject({ ok: false });
    expect(requests).toHaveLength(0);
    expect(await createOpenVsx(fetch).download("sample.sample-theme")).toMatchObject({ ok: false, message: expect.stringMatching(/license/) });
  });
});
