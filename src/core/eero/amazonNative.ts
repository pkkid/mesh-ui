/**
 * Amazon-native OpenID + OAuth2 PKCE sign-in protocol (eero Android APK
 * path), shared by the Electron host window and unit tests. Builds the
 * Amazon sign-in URL, validates the return, and exchanges the authorization
 * code for an Amazon access token. Browser cookies are never read; the
 * access token is handed to EeroClient.amazonLogin. Ported from
 * unofficial_eero_desktop_native AmazonNativeAttempt.
 */

import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { BackendError } from "../errors";

export const AMAZON_TOKEN_ENDPOINT = "https://api.amazon.com/auth/token";
export const AMAZON_SIGN_IN_ORIGIN = "https://www.amazon.com";
export const AMAZON_RETURN_PATH = "/ap/maplanding";
export const AMAZON_SCOPE = "device_auth_access";
export const AMAZON_APP_NAME = "EeroDesktop";
export const AMAZON_CLIENT_DOMAIN = "DeviceLegacy";
export const AMAZON_DEVICE_TYPE = "A2W01JEFAJFTXI";

const ASSOC_HANDLE = "amzn_eero_mobile_android_us";
const PAGE_ID = "eero_mobile_accounts";
const MAX_TOKEN_CHARS = 8192;
const MAX_BODY_CHARS = 65_536;
const EXCHANGE_TIMEOUT_MS = 30_000;

const AMAZON_HOSTS = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.mx",
  "amazon.com.br",
] as const;

const TOKEN_ERROR_NAMES = new Set([
  "invalid_request",
  "invalid_grant",
  "invalid_client",
  "invalid_token",
  "unauthorized_client",
  "access_denied",
  "invalid_scope",
]);

export type AmazonNativeAttemptOptions = {
  /** Mesh UI version, used in the token-exchange User-Agent. */
  appVersion: string;
  /** Optional platform label for the User-Agent, e.g. Windows. */
  platform?: string;
  /** Tests only: inject fetch (never hit api.amazon.com from unit tests). */
  fetch?: typeof fetch;
  /** Tests only: fixed random bytes so PKCE vectors are deterministic. */
  randomBytes?: (size: number) => Uint8Array;
};

export type AmazonNativeAttempt = {
  readonly verifier: string;
  readonly state: string;
  readonly client: string;
  readonly signInUrl: string;
  /** Parses the return URL and returns the authorization code. */
  authorizationCode(returned: string | URL): string;
  /** Exchanges the return URL for an Amazon access token (single use). */
  exchange(returned: string | URL, signal?: AbortSignal): Promise<string>;
};

/** RFC 7636 base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
  const bin = Buffer.from(bytes).toString("base64");
  return bin.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 code_challenge for a verifier (ASCII SHA-256, then base64url). */
export function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

function randomBase64Url(size: number, randomBytes?: (n: number) => Uint8Array): string {
  if (randomBytes) return base64Url(randomBytes(size));
  return base64Url(nodeRandomBytes(size));
}

function hexUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** True when the URI is exactly the Amazon maplanding return (https, 443, no fragment). */
export function isAmazonReturnAddress(value: string | URL): boolean {
  let uri: URL;
  try {
    uri = typeof value === "string" ? new URL(value) : value;
  } catch {
    return false;
  }
  return (
    uri.protocol === "https:" &&
    uri.hostname === "www.amazon.com" &&
    (uri.port === "" || uri.port === "443") &&
    uri.username === "" &&
    uri.password === "" &&
    uri.pathname === AMAZON_RETURN_PATH &&
    uri.hash === ""
  );
}

/** True when navigation during Amazon sign-in may continue to this HTTPS Amazon host. */
export function isAmazonAllowedNavigation(value: string): boolean {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return false;
  }
  if (uri.protocol !== "https:" || (uri.port !== "" && uri.port !== "443") || uri.username || uri.password) return false;
  const host = uri.hostname.toLowerCase();
  return AMAZON_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Parses a query string and refuses duplicate keys (Amazon callbacks must not
 * smuggle a second state or code).
 */
export function parseUniqueQuery(query: string): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = query.startsWith("?") || query.startsWith("#") ? query.slice(1) : query;
  if (!raw) return result;
  for (const item of raw.split("&")) {
    if (!item) continue;
    const eq = item.indexOf("=");
    const key = decodeURIComponent((eq < 0 ? item : item.slice(0, eq)).replace(/\+/g, " "));
    if (Object.hasOwn(result, key)) throw new BackendError("eero_error", "Amazon returned a sign-in response Mesh UI could not use. Close the window and try again.");
    result[key] = eq < 0 ? "" : decodeURIComponent(item.slice(eq + 1).replace(/\+/g, " "));
  }
  return result;
}

function isPrintableAscii(value: string, allowCommaSemicolon: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 32 || c >= 127) return false;
    if (!allowCommaSemicolon && (c === 44 || c === 59)) return false;
  }
  return true;
}

/** Builds a fresh PKCE attempt and the Amazon sign-in URL. */
export function createAmazonNativeAttempt(opts: AmazonNativeAttemptOptions): AmazonNativeAttempt {
  const verifier = randomBase64Url(32, opts.randomBytes);
  const state = randomBase64Url(32, opts.randomBytes);
  const deviceSerial = opts.randomBytes
    ? randomBase64Url(16, opts.randomBytes).replace(/-/g, "").replace(/_/g, "").toUpperCase().slice(0, 32).padEnd(32, "0")
    : randomUUID().replace(/-/g, "").toUpperCase();
  const client = hexUtf8(`${deviceSerial}#${AMAZON_DEVICE_TYPE}`);
  let consumed = false;

  const fields: Record<string, string> = {
    "openid.assoc_handle": ASSOC_HANDLE,
    pageId: PAGE_ID,
    language: "en_US",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.ns.pape": "http://specs.openid.net/extensions/pape/1.0",
    "openid.pape.max_auth_age": "0",
    "openid.ns.oa2": "http://www.amazon.com/ap/ext/oauth/2",
    "openid.oa2.response_type": "code",
    "openid.oa2.scope": AMAZON_SCOPE,
    "openid.oa2.client_id": `device:${client}`,
    "openid.oa2.code_challenge": pkceChallenge(verifier),
    "openid.oa2.code_challenge_method": "S256",
    "openid.return_to": `${AMAZON_SIGN_IN_ORIGIN}${AMAZON_RETURN_PATH}?state=${state}`,
    accountStatusPolicy: "P1",
  };
  const signInUrl =
    `${AMAZON_SIGN_IN_ORIGIN}/ap/signin?` +
    Object.entries(fields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  const platform = opts.platform?.trim() || "desktop";
  const userAgent = `EeroDesktop/${opts.appVersion} (${platform}; unofficial)`;
  const fetchFn = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  function authorizationCode(returned: string | URL): string {
    const uri = typeof returned === "string" ? new URL(returned) : returned;
    if (!isAmazonReturnAddress(uri)) {
      throw new BackendError("eero_error", "Amazon returned to an unexpected address. Close the window and try again.");
    }
    const query = parseUniqueQuery(uri.search);
    if (query.state !== state) {
      throw new BackendError("eero_error", "The Amazon response did not match this sign-in attempt. Close the window and try again.");
    }
    if (query.error !== undefined || query["openid.error"] !== undefined) {
      throw new BackendError("eero_error", "Amazon sign-in was canceled or rejected.");
    }
    const code = query["openid.oa2.authorization_code"];
    if (!code || code.length > MAX_TOKEN_CHARS || !isPrintableAscii(code, true)) {
      throw new BackendError("eero_error", "Amazon did not return a valid authorization code.");
    }
    if (query["openid.oa2.scope"] !== undefined && query["openid.oa2.scope"] !== AMAZON_SCOPE) {
      throw new BackendError("eero_error", "Amazon returned an unexpected sign-in scope.");
    }
    return code;
  }

  async function exchange(returned: string | URL, signal?: AbortSignal): Promise<string> {
    const code = authorizationCode(returned);
    if (consumed) {
      throw new BackendError("eero_error", "This sign-in attempt has already been used. Close the window and start again.");
    }
    consumed = true;

    const body = {
      app_name: AMAZON_APP_NAME,
      app_version: opts.appVersion,
      source_token_type: "authorization_code",
      source_token: code,
      requested_token_type: "access_token",
      code_verifier: verifier,
      code_algorithm: "SHA-256",
      client_id: client,
      client_domain: AMAZON_CLIENT_DOMAIN,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let response: Response;
    let text: string;
    try {
      response = await fetchFn(AMAZON_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": userAgent,
          "x-amzn-identity-auth-domain": "api.amazon.com",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
        // Never send Amazon browser cookies from a shared jar.
        credentials: "omit",
      });
      text = await response.text();
    } catch (err) {
      if (signal?.aborted || controller.signal.aborted) {
        throw new BackendError("eero_error", "Amazon sign-in was canceled.");
      }
      throw new BackendError("network_error", "Could not reach Amazon to finish sign-in. Check your internet connection.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      let category = "";
      if (text.length < MAX_BODY_CHARS) {
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          const name = typeof parsed.error === "string" ? parsed.error.toLowerCase() : "";
          if (TOKEN_ERROR_NAMES.has(name)) category = `.${name}`;
        } catch {
          /* keep bare category */
        }
      }
      throw new BackendError("eero_error", "Amazon could not finish sign-in.", {
        status: response.status,
        eeroError: `amazon.token.exchange${category}`,
      });
    }

    if (text.length > MAX_BODY_CHARS) {
      throw new BackendError("eero_error", "Amazon returned an oversized sign-in response.");
    }
    let result: { access_token?: unknown; token_type?: unknown };
    try {
      result = JSON.parse(text) as { access_token?: unknown; token_type?: unknown };
    } catch {
      throw new BackendError("eero_error", "Amazon returned an unexpected sign-in response.");
    }
    const token = typeof result.access_token === "string" ? result.access_token : "";
    const tokenType = typeof result.token_type === "string" ? result.token_type : "";
    if (tokenType.toLowerCase() !== "bearer" || !token || token.length > MAX_TOKEN_CHARS || !isPrintableAscii(token, false)) {
      throw new BackendError("eero_error", "Amazon did not return a valid access token.");
    }
    if (signal?.aborted) throw new BackendError("eero_error", "Amazon sign-in was canceled.");
    return token;
  }

  return { verifier, state, client, signInUrl, authorizationCode, exchange };
}
