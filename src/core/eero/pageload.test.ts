/**
 * Request budget of real page loads: the commands the shell, Overview and
 * eero detail pages run, through the engine and the real eero client,
 * against the fake eero server. Each command reads `GET {net}`, its
 * permissions or the account on its own; before identical reads were
 * shared, two page loads spent the whole 80 a minute budget and every later
 * read (the offline network's `eero.list` and `eero.get` in multi-shot
 * `ui:shot --fake` runs) queued for up to a minute.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createEngine, type Engine } from "../engine";
import { createEeroBackend } from "./backend";
import { READ_SHARE_MS } from "./client";
import { RateLimiter } from "./ratelimit";

// notifications.list is not a command yet, so the TopBar's read is left out.
const SHELL: [string, unknown?][] = [["auth.status"], ["account.get"], ["network.list"]];

const OVERVIEW: [string, unknown?][] = [
  ...SHELL,
  ["network.get"],
  ["network.health"],
  ["internet.get"],
  ["eero.list"],
  ["device.list"],
  ["profile.list"],
  ["events.list", { limit: 3 }],
  ["speedtest.history"],
  ["updates.get"],
  ["usage.get", { scope: "network", range: "day" }],
  ["usage.get", { scope: "eero", range: "day" }],
  ["usage.get", { scope: "profile", range: "day" }],
  ["usage.breakdown", { range: "day", by: "device" }],
];

const eeroPage = (id: string): [string, unknown?][] => [
  ...SHELL,
  ["eero.get", { eero: id }],
  ["eero.list"],
  ["network.get"],
  ["network.health"],
  ["internet.get"],
  ["usage.breakdown", { range: "day", by: "eero" }],
  ["usage.breakdown", { range: "day", by: "device" }],
  ["usage.get", { scope: "eero", id, range: "day" }],
  ["device.list", { eero: id }],
  ["eero.ports.get", { eero: id }],
  ["updates.get"],
  ["eero.firmware.history", { eero: id, limit: 5 }],
];

/** A limiter with room for any run, so a test can count requests without waiting a minute. */
const roomy = () => new RateLimiter({ perWindow: 10_000 });

function setup(readShareMs: number, limiter = new RateLimiter()) {
  const fake = createFakeEero();
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  const backend = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch, readShareMs, limiter });
  return { fake, engine: createEngine({ backend }), limiter };
}

/** Runs one page's queries at once, as React mounts them. Every one must answer. */
async function load(engine: Engine, page: [string, unknown?][]) {
  const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
  const failed = results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.code} ${r.error.message}`]));
  expect(failed).toEqual([]);
}

/** The shots of the M2.9 run: Overview, three eero pages, then the offline Lake Cabin network. */
async function shotRun(engine: Engine) {
  await load(engine, OVERVIEW);
  for (const id of ["500001", "500002", "500004"]) await load(engine, eeroPage(id));
  await engine.execute("network.select", { network: "100002" });
  await load(engine, OVERVIEW);
  await load(engine, eeroPage("500010"));
}

const reads = (fake: FakeEero, path: string) => fake.log.filter((e) => e.method === "GET" && e.path === path).length;

describe("page loads against the fake eero server", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("reads each network, its permissions and the account once per page load", async () => {
    const s = setup(READ_SHARE_MS);
    fake = s.fake;
    await load(s.engine, OVERVIEW);
    expect(reads(s.fake, "/2.2/account")).toBe(1);
    expect(reads(s.fake, "/2.2/networks/100001")).toBe(1);
    expect(reads(s.fake, "/2.2/networks/100001/permissions")).toBe(1);
  });

  it("finishes a multi-page run across both networks well under the 80 a minute budget", async () => {
    // Real timers and the default limiter: had the run gone over budget, it would wait about a minute and time out.
    const s = setup(READ_SHARE_MS);
    fake = s.fake;
    const started = Date.now();
    await shotRun(s.engine);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(s.fake.log.length).toBeLessThanOrEqual(60);
  });

  it("without sharing GET answers, the same run needs more than the 80 a minute budget (the M2.9 slow reads)", async () => {
    const s = setup(0, roomy());
    fake = s.fake;
    await shotRun(s.engine);
    expect(s.fake.log.length).toBeGreaterThan(80);
  });
});
