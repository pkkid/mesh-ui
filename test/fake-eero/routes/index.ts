/**
 * Fake eero server routes, one line per area, kept in alphabetical order.
 * Each area file exports `routes`, an array the server (test/fake-eero/server.ts)
 * flattens in this order.
 *
 *   export { routes as devices } from "./devices";
 */

export { routes as auth } from "./auth";
export { routes as events } from "./events";
export { routes as network } from "./network";
export { routes as usage } from "./usage";
