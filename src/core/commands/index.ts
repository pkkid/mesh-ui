/**
 * Every command area, one line each, kept in alphabetical order. Each area
 * file exports `commands: AnyCommand[]`; the registry flattens them.
 *
 *   export { commands as device } from "./device";
 */

export { commands as internet } from "./internet";
export { commands as network } from "./network";
