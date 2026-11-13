import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOCKED_MESSAGE } from "./setup";

describe("fetch guard", () => {
  it("blocks eero's real API before any request is sent", async () => {
    await expect(fetch("https://api-user.e2ro.com/2.2/account")).rejects.toThrow(BLOCKED_MESSAGE);
    await expect(fetch(new URL("https://API-USER.E2RO.COM/2.2/login"), { method: "POST" })).rejects.toThrow(BLOCKED_MESSAGE);
    await expect(fetch(new Request("https://other.e2ro.com/x"))).rejects.toThrow(BLOCKED_MESSAGE);
  });

  describe("local requests", () => {
    const server = createServer((_req, res) => res.end("ok"));
    let origin = "";
    beforeAll(async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("pass through to the fake server", async () => {
      const res = await fetch(`${origin}/2.2/account`);
      expect(await res.text()).toBe("ok");
    });
  });
});
