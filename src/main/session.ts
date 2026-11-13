/**
 * Persists the eero session token, but only when the OS can encrypt it with a
 * real keychain: Keychain on macOS, DPAPI on Windows, and libsecret or KWallet
 * on Linux. Otherwise the session lives in memory for this launch only. The
 * token is never written to disk in plaintext.
 */
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { SessionStorage } from "@shared/types";

type SessionFile = { v: 2; token: string };

const sessionPath = () => path.join(app.getPath("userData"), "session.json");

/**
 * Linux backends that do not protect the data. `basic_text` encrypts with a
 * key hardcoded into Chromium, so treat it the same as having no keychain.
 */
const INSECURE_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

/** Where a saved session would live. Only valid after the app is ready. */
export function sessionStorage(): SessionStorage {
  if (!safeStorage.isEncryptionAvailable()) return "memory";
  if (process.platform === "linux" && INSECURE_LINUX_BACKENDS.has(safeStorage.getSelectedStorageBackend())) {
    return "memory";
  }
  return "keychain";
}

export function loadToken(): string | null {
  let file: Partial<SessionFile> & { v?: number; encrypted?: boolean };
  try {
    file = JSON.parse(fs.readFileSync(sessionPath(), "utf8")) as typeof file;
  } catch {
    return null;
  }
  // v1 files were encrypted when `encrypted` is true; v1 plaintext is dropped.
  const encrypted = file.v === 2 || (file.v === 1 && file.encrypted === true);
  // Drop anything we cannot trust: plaintext files, sessions saved while a
  // keychain was available but is not now, or data that fails to decrypt.
  if (!encrypted || typeof file.token !== "string" || sessionStorage() !== "keychain") {
    clearToken();
    return null;
  }
  try {
    return safeStorage.decryptString(Buffer.from(file.token, "base64"));
  } catch {
    clearToken();
    return null;
  }
}

/** Saves the token if a keychain is available. Returns where it ended up. */
export function saveToken(token: string): SessionStorage {
  if (sessionStorage() !== "keychain") {
    clearToken();
    return "memory";
  }
  const file: SessionFile = { v: 2, token: safeStorage.encryptString(token).toString("base64") };
  writeFileAtomic(sessionPath(), JSON.stringify(file));
  return "keychain";
}

export function clearToken(): void {
  fs.rmSync(sessionPath(), { force: true });
}

/**
 * Writes via a temp file and rename so a crash never leaves a half-written
 * session. chmod enforces owner-only access even if the temp file existed
 * with looser permissions. On Windows chmod is a no-op and the per-user
 * AppData ACLs protect the file instead.
 */
function writeFileAtomic(target: string, data: string): void {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
