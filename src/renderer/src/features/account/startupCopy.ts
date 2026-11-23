/** The Application settings section's words (ApplicationSettings.tsx). No `~` imports, so they are unit tested in Node. */

/** Start at login's description: what a login launch does with the tray setting as it is now. */
export function startAtLoginDetail(supported: boolean | undefined, startsInTray: boolean): string {
  if (supported === false) return "Open Mesh UI when you sign in to this computer. Not available in a development build.";
  if (startsInTray) return "Start Mesh UI hidden in the tray when you sign in to this computer. Desktop alerts arrive without the window opening.";
  return "Open the Mesh UI window when you sign in to this computer. Turn on Keep running in the tray to start hidden in the tray instead.";
}

/**
 * The section's description from the settings: what happens at login, when the window closes and how
 * updates arrive. `autoUpdate` is null where this copy does not update itself, so updates go unmentioned.
 */
export function applicationSummary(startAtLogin: boolean | undefined, inTray: boolean | undefined, autoUpdate?: boolean | null, beta?: boolean): string {
  if (startAtLogin === undefined || inTray === undefined) return "How Mesh UI starts, stops and updates on this computer.";
  const login = startAtLogin ? (inTray ? "Starts in the tray at login" : "Opens at login") : "Opens only when you start it";
  const close = inTray ? "Closing the window keeps it running in the tray." : "Closing the window quits it.";
  const updates = autoUpdate == null ? "" : autoUpdate ? (beta ? " Updates automatically, betas included." : " Updates automatically.") : " Updates only when you check.";
  return `${login}. ${close}${updates}`;
}
