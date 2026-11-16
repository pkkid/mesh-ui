/**
 * Product glyphs for eero and Amazon Echo hardware, drawn in lucide's style
 * (24px grid, 2px stroke, round caps and joins) and built with lucide's own
 * factory so they take the same props as any lucide icon. Every eero shows
 * its status LED; every Echo shows its light ring, screen or speaker.
 *
 * Which product gets which glyph is decided in `deviceIcons.ts`
 * (`eeroIcon`, `deviceIcon`); nothing else should pick these directly.
 */
import { createLucideIcon } from "lucide-react";

/** eero 1st/2nd gen, 6, 6 Extender, 6+, Pro, Pro 6, Pro 6E: a squircle puck seen from above, LED on the front edge. */
export const EeroPuck = createLucideIcon("eero-puck", [
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "5", key: "body" }],
  ["path", { d: "M3 14.5h18", key: "edge" }],
  ["path", { d: "M12 17.3h.01", key: "led" }],
]);

/** eero 7, Pro 7, Max 7: upright with a rounded top, tapering slightly, LED near the top. */
export const EeroUpright = createLucideIcon("eero-upright", [
  ["path", { d: "M4 7.5a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5l-.7 12.5a2 2 0 0 1-2 2H6.7a2 2 0 0 1-2-2z", key: "body" }],
  ["path", { d: "M12 6.5h.01", key: "led" }],
]);

/** eero Outdoor 7: a panel on a pole mount with its cable below. */
export const EeroOutdoor = createLucideIcon("eero-outdoor", [
  ["path", { d: "M3 2v20", key: "pole" }],
  ["path", { d: "M3 7h4", key: "bracket-top" }],
  ["path", { d: "M3 15h4", key: "bracket-bottom" }],
  ["path", { d: "M7 7a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z", key: "body" }],
  ["path", { d: "M13.5 19v3", key: "cable" }],
]);

/** eero Beacon: a plug-in with its night light shining down. */
export const EeroBeacon = createLucideIcon("eero-beacon", [
  ["rect", { x: "6", y: "2", width: "12", height: "14", rx: "4", key: "body" }],
  ["path", { d: "M12 6h.01", key: "led" }],
  ["path", { d: "M12 19v2.5", key: "ray-mid" }],
  ["path", { d: "M8 18.5l-1.2 2", key: "ray-left" }],
  ["path", { d: "M16 18.5l1.2 2", key: "ray-right" }],
]);

/** eero PoE 6 and PoE 7: a flat unit on the ceiling, broadcasting down. */
export const EeroCeiling = createLucideIcon("eero-ceiling", [
  ["path", { d: "M2 3h20", key: "ceiling" }],
  ["path", { d: "M12 3v2", key: "mount" }],
  ["rect", { x: "4", y: "5", width: "16", height: "6", rx: "3", key: "body" }],
  ["path", { d: "M12 8h.01", key: "led" }],
  ["path", { d: "M8.5 15q3.5 2.5 7 0", key: "wave-near" }],
  ["path", { d: "M6 18q6 4.5 12 0", key: "wave-far" }],
]);

/** eero PoE Gateway: a box with a row of Ethernet ports and its LED. */
export const EeroGateway = createLucideIcon("eero-gateway", [
  ["rect", { x: "2", y: "7", width: "20", height: "10", rx: "2", key: "body" }],
  ["path", { d: "M6 11v2", key: "port-1" }],
  ["path", { d: "M9 11v2", key: "port-2" }],
  ["path", { d: "M12 11v2", key: "port-3" }],
  ["path", { d: "M15 11v2", key: "port-4" }],
  ["path", { d: "M18.5 12h.01", key: "led" }],
]);

/** Echo Dot 1st to 3rd gen (with or without clock), Echo Input: a flat puck with the light ring round its top edge. */
export const EchoPuck = createLucideIcon("echo-puck", [
  ["ellipse", { cx: "12", cy: "9", rx: "9", ry: "3.5", key: "top" }],
  ["path", { d: "M3 9v5.5a9 3.5 0 0 0 18 0V9", key: "side" }],
  ["path", { d: "M3.4 11.2a9 3.5 0 0 0 17.2 0", key: "ring" }],
]);

/** Echo 4th gen, Echo Dot 4th gen and later (with or without clock): a sphere on its light ring. */
export const EchoSphere = createLucideIcon("echo-sphere", [
  ["circle", { cx: "12", cy: "10.5", r: "8", key: "body" }],
  ["ellipse", { cx: "12", cy: "20", rx: "5", ry: "1.5", key: "ring" }],
]);

/** Echo 1st to 3rd gen, Echo Plus, Echo Studio, Echo Sub: a cylinder with the light ring on top. */
export const EchoCylinder = createLucideIcon("echo-cylinder", [
  ["ellipse", { cx: "12", cy: "5", rx: "7", ry: "2.5", key: "top" }],
  ["path", { d: "M5 5v14a7 2.5 0 0 0 14 0V5", key: "side" }],
  ["path", { d: "M5 8.5a7 2.5 0 0 0 14 0", key: "ring" }],
]);

/** Echo Pop: a sphere with its front sliced off, light bar along the cut. */
export const EchoPop = createLucideIcon("echo-pop", [
  ["path", { d: "M8.5 4.1 18 15.4A8.5 8.5 0 1 1 8.5 4.1Z", key: "body" }],
  ["path", { d: "M9.6 7.2l2 2.4", key: "light" }],
]);

/** Echo Spot: a round face, screen over fabric, on a base. */
export const EchoSpot = createLucideIcon("echo-spot", [
  ["circle", { cx: "12", cy: "10.5", r: "8", key: "body" }],
  ["path", { d: "M5.1 14.5h13.8", key: "screen" }],
  ["path", { d: "M6.5 21h11", key: "base" }],
]);

/** Echo Flex: a plug-in box with prongs, a slot, a button and a speaker slot. */
export const EchoFlex = createLucideIcon("echo-flex", [
  ["rect", { x: "5", y: "4", width: "14", height: "17", rx: "3", key: "body" }],
  ["path", { d: "M9.5 4V2", key: "prong-left" }],
  ["path", { d: "M14.5 4V2", key: "prong-right" }],
  ["path", { d: "M10.5 8h3", key: "slot-top" }],
  ["circle", { cx: "12", cy: "12.5", r: "1.5", key: "button" }],
  ["path", { d: "M10.5 17h3", key: "slot-bottom" }],
]);

/** Every Echo Show size and the Echo Hub: a screen in a bezel with its camera. */
export const EchoDisplay = createLucideIcon("echo-display", [
  ["rect", { x: "2", y: "3", width: "20", height: "17", rx: "2", key: "body" }],
  ["rect", { x: "5", y: "7", width: "14", height: "10", rx: "1", key: "screen" }],
  ["path", { d: "M12 5h.01", key: "camera" }],
]);
