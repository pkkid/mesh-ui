/** The Startup and tray section's words (StartupTray.tsx). No `~` imports, so they are unit tested in Node. */

/** Start at login's description: what a login launch does with the tray setting as it is now. */
export function startAtLoginDetail(supported: boolean | undefined, startsInTray: boolean): string {
  if (supported === false) return "Open Mesh UI when you sign in to this computer. Not available in a development build.";
  if (startsInTray) return "Start Mesh UI hidden in the tray when you sign in to this computer. Desktop alerts arrive without the window opening.";
  return "Open the Mesh UI window when you sign in to this computer. Turn on Keep running in the tray to start hidden in the tray instead.";
}

/** The section's description from the two settings: what happens at login and when the window closes. */
export function startupSummary(startAtLogin: boolean | undefined, inTray: boolean | undefined): string {
  if (startAtLogin === undefined || inTray === undefined) return "How Mesh UI starts and stops on this computer.";
  const login = startAtLogin ? (inTray ? "Starts in the tray at login" : "Opens at login") : "Opens only when you start it";
  return `${login}. ${inTray ? "Closing the window keeps it running in the tray." : "Closing the window quits it."}`;
}
