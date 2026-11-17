/**
 * The words for 2.4 GHz only (`wifi.hide5g.set`), in one place so the command
 * description, its confirm, the Wi-Fi Bands card and the Troubleshooting fix
 * all say the same thing. eero picks the length itself and does not say it
 * ahead of time, so the copy says "for a while"; once on, `hide5g.expiresAt`
 * drives a countdown.
 */
export const HIDE_5G = {
  /** When you would want it. */
  why: "Only needed while setting up an older or smart home device (plug, camera, bulb) that can't find your Wi-Fi. Leave it off otherwise.",
  /** What turning it on costs. */
  cost: "Turning it on hides 5 and 6 GHz for a while; phones and laptops drop to 2.4 GHz until eero turns it off on its own.",
  /** Tooltip on the Turn on button. */
  action: "Hides 5 and 6 GHz for a while so a 2.4 GHz only device can join. Devices on 5 and 6 GHz reconnect on 2.4 GHz meanwhile.",
  /** While it is on. */
  active: "5 and 6 GHz are hidden, so every device is on 2.4 GHz. Set up the device now; eero turns this off when the time runs out.",
} as const;
