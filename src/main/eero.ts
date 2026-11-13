/**
 * Minimal client for eero's unofficial cloud API (the same one the mobile app
 * uses). Runs in the main process only so the session token never reaches the
 * renderer.
 */
import type { Device, Network } from "@shared/types";

const BASE = "https://api-user.e2ro.com";

type EeroResponse<T> = { meta?: { error?: string; server_error?: string }; data: T };

async function call<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `s=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<EeroResponse<T>>;
  if (!res.ok) {
    const msg = json.meta?.error || json.meta?.server_error || res.statusText;
    throw new EeroError(res.status, `${method} ${path}: ${res.status} ${msg}`);
  }
  return json.data as T;
}

export class EeroError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Raw API shapes, limited to the fields we read.
type RawNetworkRef = { url: string; name: string };
type RawAccount = { networks: { data: RawNetworkRef[] } };
type RawDevice = {
  url: string;
  mac?: string;
  ip?: string;
  nickname?: string;
  display_name?: string;
  hostname?: string;
  manufacturer?: string;
  connected: boolean;
  wireless: boolean;
  connectivity?: { frequency?: number | string };
  source?: { location?: string };
};

/** Sends a verification code to the email or phone. Returns an unverified token. */
export async function startLogin(login: string): Promise<string> {
  const data = await call<{ user_token: string }>("POST", "/2.2/login", null, { login });
  return data.user_token;
}

export async function verify(token: string, code: string): Promise<void> {
  await call("POST", "/2.2/login/verify", token, { code });
}

/** Invalidates the session on eero's side so a copied token stops working. */
export async function logout(token: string): Promise<void> {
  await call("POST", "/2.2/logout", token);
}

export async function loadNetworks(token: string): Promise<Network[]> {
  const account = await call<RawAccount>("GET", "/2.2/account", token);
  return Promise.all(
    account.networks.data.map(async (net) => {
      const devices = await call<RawDevice[]>("GET", `${net.url}/devices`, token);
      return { id: net.url, name: net.name, devices: devices.map(toDevice) };
    }),
  );
}

function toDevice(d: RawDevice): Device {
  return {
    id: d.url,
    name: d.nickname || d.display_name || d.hostname || d.manufacturer || d.mac || "Unknown",
    ip: d.ip ?? null,
    mac: d.mac ?? null,
    manufacturer: d.manufacturer ?? null,
    connected: d.connected,
    wireless: d.wireless,
    frequency: d.connectivity?.frequency != null ? String(d.connectivity.frequency) : null,
    via: d.source?.location ?? null,
  };
}
