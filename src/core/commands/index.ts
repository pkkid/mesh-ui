/**
 * Every command area, one line each, kept in alphabetical order. Each area
 * file exports `commands: AnyCommand[]`; the registry flattens them.
 *
 *   export { commands as device } from "./device";
 */

export { commands as account } from "./account";
export { commands as activity } from "./activity";
export { commands as app } from "./app";
export { commands as auth } from "./auth";
export { commands as demo } from "./demo";
export { commands as internet } from "./internet";
export { commands as network } from "./network";
export { commands as usage } from "./usage";
