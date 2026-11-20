/**
 * Dev tools request inspection (inspect.ts) through the real eero client
 * against the fake eero server: records only while a listener is set, the
 * command that caused each request, and no session token anywhere in them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { EeroClient } from "./client";
import { type InspectRecord, inspecting, RESPONSE_CAP_BYTES, redactBody, setInspector, withCommand } from "./inspect";

function memorySecrets(initial: string | null): SecretStore {
  let token = initial;
  return {
    load: async () => token,
    save: async (t) => {
      token = t;
      return "keychain";
    },
    clear: async () => {
      token = null;
    },
    storage: async () => "keychain",
  };
}

function setup() {
  const fake = createFakeEero();
  const token = fake.signIn();
  const client = new EeroClient({ secrets: memorySecrets(token), origin: fake.origin, fetch: fake.fetch });
  return { fake, token, client };
}

/** The final state of each record, by id. */
function collect(): { records: Map<number, InspectRecord>; emits: InspectRecord[] } {
  const records = new Map<number, InspectRecord>();
  const emits: InspectRecord[] = [];
  setInspector((r) => {
    emits.push(r);
    records.set(r.id, r);
  });
  return { records, emits };
}

afterEach(() => setInspector(null));

describe("request inspection", () => {
  it("records nothing and keeps no command context while off", async () => {
    const { client } = setup();
    expect(inspecting()).toBe(false);
    const seen: InspectRecord[] = [];
    await withCommand("account.get", () => client.request({ method: "GET", path: "/2.2/account" }));
    setInspector((r) => seen.push(r));
    setInspector(null);
    expect(seen).toEqual([]);
  });

  it("captures a request with its command, status, headers, timing and size", async () => {
    const { client } = setup();
    const { records, emits } = collect();
    await withCommand("account.get", () => client.request({ method: "GET", path: "/2.2/account" }));
    const [r] = [...records.values()];
    expect(r).toBeDefined();
    if (!r) return;
    expect(emits[0]?.outcome).toBe("pending");
    expect(r).toMatchObject({ method: "GET", command: "account.get", status: 200, outcome: "ok", attempt: 0, truncated: false });
    expect(r.url.endsWith("/2.2/account")).toBe(true);
    expect(r.responseBytes).toBeGreaterThan(0);
    expect(JSON.parse(r.responseBody ?? "null")).toHaveProperty("data");
    expect(r.timing && r.timing.totalMs >= 0).toBe(true);
    expect(r.requestHeaders.find(([k]) => k === "Cookie")?.[1]).toBe("s=(hidden)");
    expect(r.requestHeaders.find(([k]) => k === "X-User-Token")?.[1]).toBe("(hidden)");
  });

  it("never holds the session token, before or after a refresh rotates it", async () => {
    const { fake, token, client } = setup();
    const { records } = collect();
    fake.scenarios.sessionRefresh();
    await withCommand("account.get", () => client.request({ method: "GET", path: "/2.2/account" }));
    const all = [...records.values()];
    expect(all.map((r) => `${r.method} ${new URL(r.url).pathname} ${r.status} ${r.outcome} ${r.attempt}`)).toEqual([
      "GET /2.2/account 401 refresh 0",
      "POST /2.2/login/refresh 200 ok 0",
      "GET /2.2/account 200 ok 1",
    ]);
    const fresh = fake.log[2]?.token;
    const text = JSON.stringify(all);
    expect(text).not.toContain(token);
    if (fresh) expect(text).not.toContain(fresh);
  });

  it("hides tokens and the verification code in bodies, and cuts large responses", () => {
    expect(redactBody("login=al%40example.com&code=123456", /token|^code$|password/i)).toBe("login=al%40example.com&code=%28hidden%29");
    expect(JSON.parse(redactBody('{"data":{"user_token":"abc","name":"x"}}', /token/i))).toEqual({ data: { user_token: "(hidden)", name: "x" } });
    expect(redactBody("not json", /token/i)).toBe("not json");
    expect(RESPONSE_CAP_BYTES).toBe(256 * 1024);
  });
});
