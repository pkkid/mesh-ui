/** The hold count the page transition waits on (pageLoad.ts). */
import { describe, expect, it, vi } from "vitest";

import { PageLoad } from "./pageLoad";

describe("PageLoad", () => {
  it("counts holds and tells listeners", () => {
    const load = new PageLoad();
    const listener = vi.fn();
    load.subscribe(listener);
    const a = load.hold();
    const b = load.hold();
    expect(load.pending).toBe(2);
    a();
    expect(load.pending).toBe(1);
    b();
    expect(load.pending).toBe(0);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("releases each hold once", () => {
    const load = new PageLoad();
    const release = load.hold();
    release();
    release();
    expect(load.pending).toBe(0);
  });
});
