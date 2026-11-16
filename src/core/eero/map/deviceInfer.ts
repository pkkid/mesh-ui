/**
 * A best guess at what a device is when eero only says `generic`, which it
 * does for most devices. Read in order: the model name, the hostname, then
 * the manufacturer. A guess is an eero `device_type`, or only a category
 * when the maker is known but its products vary (Nest, Intel). No match
 * gives null, and the device stays "other".
 *
 * Used for the icon and the category only. `Device.type` keeps eero's value,
 * so device.type.set and the Appearance grid show what eero has.
 */

import type * as M from "../../model";

export type DeviceGuess = { type: string } | { category: M.DeviceCategory };

type Rule = [RegExp, DeviceGuess];
const t = (type: string): DeviceGuess => ({ type });

/**
 * Product words in a model name or hostname. Separators are spaces by the
 * time these run ("ESP_3A9F21" is "esp 3a9f21"). Order matters: the first
 * match wins, so specific names come before the words they contain.
 */
const TEXT_RULES: Rule[] = [
  [/\becho\b|\balexa\b/, t("digital_assistant")],
  [/\bkindle\b/, t("e_reader")],
  [/\bfire ?tv\b|\bapple ?tv\b|\bchromecast\b|\bshield\b/, t("media_streamer")],
  [/\btv\b|\btelevision\b|webos|\bbravia\b/, t("television")],
  [/\broku\b/, t("media_streamer")],
  [/\bipad\b|\btablet\b|\bgalaxy tab\b|\bfire (hd|\d+)\b/, t("tablet")],
  [/phone\b|\bpixel\b|\bgalaxy\b|\bandroid\b/, t("phone")],
  [/\bwatch\b/, t("watch")],
  [/\bmacbook\b|\blaptop\b|\bchromebook\b|\bthinkpad\b/, t("laptop_computer")],
  [/\bimac\b|\bmac ?(mini|studio|pro)\b|\bdesktop\b/, t("desktop_computer")],
  [/\bhomepod\b|\bsonos\b|\bspeaker\b|\bsoundbar\b/, t("audio")],
  [/\bplaystation\b|\bps[345]\b|\bxbox\b|\bnintendo\b|\bsteam ?deck\b/, t("game_console")],
  [/\bprinter\b|laserjet|officejet|deskjet|\bbr[nw][0-9a-f]{6,}|^hp[0-9a-f]{6}\b/, t("printer")],
  [/\bdoorbell\b/, t("door_bell")],
  [/\bsmoke\b|\bnest protect\b/, t("smoke_detector")],
  [/\bthermostat\b|\becobee\b/, t("thermostat")],
  [/\bcamera\b|\bcam\b|\bwyze\b|\barlo\b/, t("security_camera")],
  [/\broomba\b|\bvacuum\b|\broborock\b/, t("vacuum")],
  [/\bplug\b|\bwemo\b|\bkasa\b|\besp\b|\besp32\b|\besp8266\b|\btasmota\b|\bshelly\b/, t("plug")],
  [/\bhue\b|\blifx\b|\bbulb\b|\blamp\b|\blight/, t("light")],
  [/\bmyq\b|\bgarage\b/, t("garage_door")],
  [/\brachio\b|\bsprinkler\b/, t("sprinkler")],
  [/\block\b/, t("door_lock")],
  [/\bnas\b|\bsynology\b|\bdiskstation\b|\bqnap\b/, t("hard_drive")],
  [/\braspberry ?pi\b|\brpi\b/, t("unknown_computer")],
];

/**
 * Makers whose network devices are mostly one kind of thing. Makers of many
 * kinds (Apple, Amazon, Google, Samsung, Microsoft, LG, TP-Link) are left out:
 * a wrong icon is worse than a neutral one.
 */
const MAKER_RULES: Rule[] = [
  [/\bsonos\b|\bbose\b/, t("audio")],
  [/\broku\b/, t("media_streamer")],
  [/^ring\b/, t("door_bell")],
  [/\bnest labs\b|\bgoogle nest\b/, { category: "smart_home" }],
  [/\bespressif\b|\btuya\b|\bshelly\b|\bkasa\b/, t("plug")],
  [/\bhewlett|^hp\b|\bbrother\b|\bepson\b|\bcanon\b|\bxerox\b|\blexmark\b/, t("printer")],
  [/\bnintendo\b|\bsony interactive\b/, t("game_console")],
  [/\becobee\b|\bhoneywell\b|\bresideo\b/, t("thermostat")],
  [/\birobot\b|\broborock\b|\becovacs\b/, t("vacuum")],
  [/\bsignify\b|\bphilips lighting\b|\blifx\b/, t("light")],
  [/\bchamberlain\b/, t("garage_door")],
  [/\brachio\b/, t("sprinkler")],
  [/\bwyze\b|\barlo\b/, t("security_camera")],
  [/\baugust\b/, t("door_lock")],
  [/\bsynology\b|\bqnap\b|\bwestern digital\b/, t("hard_drive")],
  [/\bvizio\b|\bhisense\b|\btcl\b/, t("television")],
  [/\braspberry pi\b/, t("unknown_computer")],
  [/\bintel\b/, { category: "computers" }],
];

const words = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[_\-.]+/g, " ").trim();

function match(rules: Rule[], text: string): DeviceGuess | null {
  if (!text) return null;
  for (const [re, guess] of rules) if (re.test(text)) return guess;
  return null;
}

/** The guess for a device eero calls `generic`, or null when nothing fits. */
export function inferDevice(d: { model?: string | null; hostname?: string | null; manufacturer?: string | null }): DeviceGuess | null {
  return match(TEXT_RULES, words(d.model)) ?? match(TEXT_RULES, words(d.hostname)) ?? match(MAKER_RULES, words(d.manufacturer));
}
