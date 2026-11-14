/**
 * Runs before every test file. Guards the sandbox: no test may reach eero's
 * cloud API, so global fetch throws for any *.e2ro.com host (the real API is
 * api-user.e2ro.com). Local requests (the fake eero server on 127.0.0.1)
 * pass through. See docs/testing.md.
 */

// Warm ICU before any test starts. The first collator, time-zone date format
// and number format in a process load ICU data: about 4ms here, but on CI
// runners it has taken 1 to 9s, which lands in whichever test first sorts by
// name or does local-time math and blows its 5s timeout (eero.list sorting,
// usageWindow, device sort by usage, the fixture determinism test). Setup
// files run outside test timeouts. The forms mirror what src/ uses.
"a".localeCompare("b");
"a".localeCompare("b", "en", { sensitivity: "base" });
new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "numeric", second: "numeric" }).formatToParts(0);
(1234.5).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const EERO_HOST = /(^|\.)e2ro\.com\.?$/i;

export const BLOCKED_MESSAGE = "Blocked: tests must never call eero's real API. Use the demo backend or the fake eero server.";

function hostOf(input: RequestInfo | URL): string | null {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

export function isEeroHost(input: RequestInfo | URL): boolean {
  const host = hostOf(input);
  return host !== null && EERO_HOST.test(host);
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isEeroHost(input)) throw new Error(BLOCKED_MESSAGE);
  return realFetch(input, init);
};
