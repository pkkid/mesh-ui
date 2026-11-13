/**
 * The demo backend entry. Until M1.3 lands its fixtures, every area answers
 * "not available yet". M1.3 replaces the body with:
 *
 *   export { createDemoBackend } from "./backend";
 */

import { type Backend, composeBackend } from "../backend";

export function createDemoBackend(): Backend {
  return composeBackend("demo", {});
}
