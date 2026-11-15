/**
 * The host `SecretStore` over Electron `safeStorage` (docs/architecture/security.md#session-storage).
 *
 * - The token is saved only when a real OS keychain encrypts it: Keychain on
 *   macOS, DPAPI on Windows, libsecret or KWallet on Linux. Linux
 *   `basic_text` (a key hardcoded into Chromium) and `unknown` count as no
 *   keychain. Without one the session stays in memory; there is no
 *   plaintext fallback.
 * - It uses the async `safeStorage` API (the sync calls are deprecated in
 *   Electron 45). Files written by the sync API still decrypt with
 *   `decryptStringAsync`; when it says `shouldReEncrypt` (a rotated or
 *   stronger key) the session is written again.
 * - On load, plaintext files, v1 files that were not encrypted, files saved
 *   while a keychain existed but does not now, and data that fails to
 *   decrypt are deleted. Encrypted v1 files are read and rewritten as v2.
 * - Writes are atomic (temp file plus rename) and owner-only (0600).
 *
 * `safeStorage` is injected so tests can swap in a fake backend.
 */

import fs from "node:fs";
import path from "node:path";
import type { SecretStore } from "../core/backend";
import type { SessionStorageKind } from "../core/model";

/** The parts of Electron's `safeStorage` this store uses. */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  /** Linux only in Electron. */
  getSelectedStorageBackend?(): string;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export type SecretStoreOptions = {
  /** Path of session.json. */
  file: string;
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
};

type SessionFileV2 = { v: 2; token: string };

/** Linux backends that do not protect the data. */
const INSECURE_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

/** True when the Linux backend is one that does not protect the data. */
function insecureLinuxBackend(safeStorage: SafeStorageLike, platform: NodeJS.Platform): boolean {
  return platform === "linux" && INSECURE_LINUX_BACKENDS.has(safeStorage.getSelectedStorageBackend?.() ?? "unknown");
}

/** "keychain" when a save would persist, else "memory". Valid after app ready. */
export async function storageKind(safeStorage: SafeStorageLike, platform: NodeJS.Platform): Promise<SessionStorageKind> {
  let available: boolean;
  try {
    available = await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    available = false;
  }
  if (!available || insecureLinuxBackend(safeStorage, platform)) return "memory";
  return "keychain";
}

/**
 * The keychain's user-facing name, or null for a Linux backend that is no
 * keychain. Sync, so it does not check availability: `app.info` shows it only
 * when `auth.status` reports `keychain`, which `storageKind` decides.
 */
export function keychainName(safeStorage: SafeStorageLike, platform: NodeJS.Platform): string | null {
  if (insecureLinuxBackend(safeStorage, platform)) return null;
  if (platform === "darwin") return "macOS Keychain";
  if (platform === "win32") return "Windows DPAPI";
  const backend = safeStorage.getSelectedStorageBackend?.() ?? "";
  if (backend === "gnome_libsecret") return "GNOME Keyring";
  if (backend.startsWith("kwallet")) return "KWallet";
  return "System keychain";
}

export function createSecretStore({ file, safeStorage, platform }: SecretStoreOptions): SecretStore {
  const storage = () => storageKind(safeStorage, platform);
  const clear = () => fs.rmSync(file, { force: true });

  const save = async (token: string): Promise<SessionStorageKind> => {
    if ((await storage()) !== "keychain") {
      clear();
      return "memory";
    }
    const body: SessionFileV2 = { v: 2, token: (await safeStorage.encryptStringAsync(token)).toString("base64") };
    writeFileAtomic(file, JSON.stringify(body));
    return "keychain";
  };

  const load = async (): Promise<string | null> => {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
    let parsed: { v?: unknown; encrypted?: unknown; token?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      clear();
      return null;
    }
    const encrypted = parsed?.v === 2 || (parsed?.v === 1 && parsed.encrypted === true);
    if (!encrypted || typeof parsed.token !== "string" || (await storage()) !== "keychain") {
      clear();
      return null;
    }
    let token: string;
    let reEncrypt: boolean;
    try {
      const out = await safeStorage.decryptStringAsync(Buffer.from(parsed.token, "base64"));
      token = out.result;
      reEncrypt = out.shouldReEncrypt;
    } catch {
      clear();
      return null;
    }
    if (!token) {
      clear();
      return null;
    }
    if (parsed.v === 1 || reEncrypt) {
      try {
        await save(token);
      } catch {
        // The old file still holds the encrypted token; it is rewritten on the next load or save.
      }
    }
    return token;
  };

  return { load, save, clear: async () => clear(), storage };
}

/**
 * Temp file plus rename so a crash never leaves a half-written session.
 * chmod enforces owner-only access even if the temp file existed with looser
 * permissions. On Windows chmod is a no-op and per-user AppData ACLs protect
 * the file instead.
 */
function writeFileAtomic(target: string, data: string): void {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
