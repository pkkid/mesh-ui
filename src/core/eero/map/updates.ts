/**
 * Maps `GET {net}/updates` to the model. Pure: no requests. eero sends no
 * per-eero versions here, so they come from the eeros (`GET {net}/eeros`),
 * and `current` is the gateway's version. See
 * docs/architecture/data-model.md (Updates and admins).
 */

import type * as M from "../../model";
import { linkUrl, type RawUpdates } from "../raw";
import { idFromUrl } from "../urls";
import { toIso } from "./network";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** eero `update_status` words, falling back to `has_update` and a scheduled time. */
export function updateStatus(raw: RawUpdates): M.Updates["status"] {
  switch (str(raw.update_status)?.toLowerCase()) {
    case "up_to_date":
    case "none":
      return "up_to_date";
    case "available":
      return "available";
    case "scheduled":
      return "scheduled";
    case "installing":
    case "updating":
    case "in_progress":
    case "downloading":
      return "installing";
  }
  if (raw.has_update !== true) return "up_to_date";
  return toIso(raw.scheduled_update_time) ? "scheduled" : "available";
}

export function mapUpdates(raw: RawUpdates | null | undefined, eeros: Pick<M.Eero, "id" | "location" | "firmware" | "isGateway">[]): M.Updates {
  const r = raw ?? {};
  const status = updateStatus(r);
  const gateway = eeros.find((e) => e.isGateway) ?? eeros[0];
  const hour = typeof r.preferred_update_hour === "number" && Number.isInteger(r.preferred_update_hour) && r.preferred_update_hour >= 0 && r.preferred_update_hour <= 23 ? r.preferred_update_hour : null;
  const stuck = [...(r.last_user_update?.unresponsive_eeros ?? []), ...(r.last_user_update?.incomplete_eeros ?? [])]
    .map((l) => linkUrl(l))
    .filter((u): u is string => u !== null)
    .map(idFromUrl);
  return {
    status,
    current: gateway?.firmware ?? null,
    target: status === "up_to_date" ? null : (str(r.target_firmware) ?? str(r.update_to_firmware)),
    canUpdateNow: r.can_update_now === true && status !== "up_to_date" && status !== "installing",
    required: r.update_required === true,
    scheduledAt: status === "scheduled" ? toIso(r.scheduled_update_time) : null,
    preferredHour: hour,
    lastUpdatedAt: toIso(r.last_update_started),
    eeros: eeros.map((e) => ({ id: e.id, location: e.location, firmware: e.firmware })),
    stuckEeros: [...new Set(stuck)],
  };
}
