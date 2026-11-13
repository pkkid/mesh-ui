/**
 * The host `SecretStore` over Electron `safeStorage` (docs/architecture/security.md#session-storage).
 *
 * - The token is saved only when a real OS keychain encrypts it: Keychain on
 *   macOS, DPAPI on Windows, libsecret or KWallet on Linux. Linux
 *   `basic_text` (a key hardcoded into Chromium) and `unknown` count as no
 *   keychain. Without one the session stays in memory; there is no
 *   plaintext fallback.
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
  isEncryptionAvailable(): boolean;
  /** Linux only in Electron. */
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
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

/** "keychain" when a save would persist, else "memory". Valid after app ready. */
export function storageKind(safeStorage: SafeStorageLike, platform: NodeJS.Platform): SessionStorageKind {
  if (!safeStorage.isEncryptionAvailable()) return "memory";
  if (platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend?.() ?? "unknown";
    if (INSECURE_LINUX_BACKENDS.has(backend)) return "memory";
  }
  return "keychain";
}

/** The keychain's user-facing name, or null when there is none. */
export function keychainName(safeStorage: SafeStorageLike, platform: NodeJS.Platform): string | null {
  if (storageKind(safeStorage, platform) !== "keychain") return null;
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

  const save = (token: string): SessionStorageKind => {
    if (storage() !== "keychain") {
      clear();
      return "memory";
    }
    const body: SessionFileV2 = { v: 2, token: safeStorage.encryptString(token).toString("base64") };
    writeFileAtomic(file, JSON.stringify(body));
    return "keychain";
  };

  const load = (): string | null => {
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
    if (!encrypted || typeof parsed.token !== "string" || storage() !== "keychain") {
      clear();
      return null;
    }
    let token: string;
    try {
      token = safeStorage.decryptString(Buffer.from(parsed.token, "base64"));
    } catch {
      clear();
      return null;
    }
    if (!token) {
      clear();
      return null;
    }
    if (parsed.v === 1) save(token);
    return token;
  };

  return {
    load: async () => load(),
    save: async (token) => save(token),
    clear: async () => clear(),
    storage: async () => storage(),
  };
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
