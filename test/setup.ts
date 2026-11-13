/**
 * Runs before every test file. Guards the sandbox: no test may reach eero's
 * cloud API, so global fetch throws for any *.e2ro.com host (the real API is
 * api-user.e2ro.com). Local requests (the fake eero server on 127.0.0.1)
 * pass through. See docs/testing.md.
 */

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
