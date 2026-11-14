/**
 * What a write makes stale (`affectedBy` and `RELATED`). The routing lists
 * share one routing read in core, and device detail shows a device's
 * reservation, so every routing write (and its Undo, which is another routing
 * write) refreshes all three routing areas and the device reads.
 */
import { describe, expect, it } from "vitest";

import { allCommands } from "../../../core/registry";
import { affectedBy } from "./useCommand";

const ROUTING_WRITES = allCommands()
  .filter((c) => ["reservation", "forward", "pinhole"].includes(c.id.split(".")[0] ?? "") && c.effect !== "query")
  .map((c) => c.id);

describe("affectedBy", () => {
  it("covers every routing write", () => {
    expect(ROUTING_WRITES).toEqual(expect.arrayContaining(["reservation.add", "reservation.update", "reservation.remove", "forward.add", "forward.update", "forward.remove", "pinhole.add", "pinhole.remove"]));
  });

  it.each(ROUTING_WRITES)("%s refreshes the routing and device reads", (id) => {
    const stale = affectedBy(id);
    for (const prefix of ["reservation.", "forward.", "pinhole.", "device.", "network.get"]) expect(stale).toContain(prefix);
  });

  it("leaves other areas alone and refreshes nothing for network.select", () => {
    expect(affectedBy("guest.update")).toEqual(["guest.", "network.get", "device."]);
    expect(affectedBy("network.select")).toBeUndefined();
  });
});
