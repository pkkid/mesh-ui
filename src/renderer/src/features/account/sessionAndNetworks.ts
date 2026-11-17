/**
 * Pure text for Account's Networks table and Sign out and delete
 * panel (NetworksTable.tsx, SignOutDelete.tsx). Relative imports only, so
 * node tests can load it.
 */
import type { AppInfo, AuthStatus, NetworkSummary } from "../../../../core/model";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Offline 2d", "Offline 3h", "Offline 5m": how long ago an offline network last checked in. */
export function offlineFor(lastSeen: string | null, now: number): string {
  const at = lastSeen ? Date.parse(lastSeen) : Number.NaN;
  if (!Number.isFinite(at)) return "Offline";
  const ago = Math.max(0, now - at);
  const short = ago >= DAY ? `${Math.floor(ago / DAY)}d` : ago >= HOUR ? `${Math.floor(ago / HOUR)}h` : `${Math.max(1, Math.floor(ago / MIN))}m`;
  return `Offline ${short}`;
}

/** Where the session is kept, in the panel's words. */
export function sessionText(auth: AuthStatus | undefined, info: AppInfo | undefined): string | null {
  if (!auth) return null;
  if (auth.backend === "demo") return "You are in demo mode: invented networks, and nothing you change reaches eero. Leave demo mode to sign in to your own account.";
  if (auth.storage === "keychain")
    return `Your session is saved in ${info?.keychainName ?? "the system keychain"} and refreshes on its own. Signing out removes it; your networks keep running.`;
  return "Your session is kept in memory only on this computer; you will sign in again next time. Signing out ends it; your networks keep running.";
}

const join = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What must happen before the account can go, from the network list. */
export function deletePlan(networks: NetworkSummary[] | undefined): { owned: string[]; shared: string[]; text: string } {
  const label = (n: NetworkSummary) => n.nickname ?? n.name;
  const owned = (networks ?? []).filter((n) => n.role !== "admin").map(label);
  const shared = (networks ?? []).filter((n) => n.role === "admin").map(label);
  const parts = ["Closes your eero account and deletes your personal data."];
  if (owned.length) parts.push(`Transfer or delete ${join(owned)} first.`);
  if (shared.length) parts.push(`You will lose admin access to ${join(shared)}.`);
  return { owned, shared, text: parts.join(" ") };
}
