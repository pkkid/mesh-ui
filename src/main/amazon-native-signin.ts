/**
 * Private Amazon sign-in window for auth.login.amazon. Opens an ephemeral
 * BrowserWindow (no preload, no IPC), runs the OpenID+PKCE flow from
 * src/core/eero/amazonNative.ts, and returns the Amazon access token to the
 * command in main. Browser cookies are never read.
 */

import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  session as electronSession,
  type BrowserWindowConstructorOptions,
  type Session,
  type WebContents,
} from "electron";
import {
  createAmazonNativeAttempt,
  isAmazonAllowedNavigation,
  isAmazonReturnAddress,
} from "../core/eero/amazonNative";
import { BackendError } from "../core/errors";

/** Partition prefix for ephemeral Amazon sign-in sessions. */
export const AMAZON_PARTITION_PREFIX = "temp:amazon-native-";

const amazonSessions = new WeakSet<Session>();

/** True when this webContents belongs to an Amazon sign-in window. */
export function isAmazonSignInContents(contents: WebContents): boolean {
  return amazonSessions.has(contents.session);
}

export type AmazonSignInDeps = {
  appVersion: string;
  platform: NodeJS.Platform;
  /** When set (demo), resolve immediately without opening Amazon. */
  instantToken?: string;
  /** Parent window for modality when available. */
  parent?: () => BrowserWindow | null;
  /** Injected for tests. */
  openWindow?: (opts: {
    partition: string;
    signInUrl: string;
    onReturn: (url: string) => void;
    onCancel: () => void;
    onUnsupported: () => void;
  }) => { close: () => void };
};

function platformLabel(platform: NodeJS.Platform): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

function createAmazonSession(partition: string): Session {
  const ses = electronSession.fromPartition(partition, { cache: false });
  amazonSessions.add(ses);
  // Like the main window: no camera, mic, location, notifications or
  // clipboard reads from page scripts (typing and Ctrl+V paste still work),
  // and no downloads.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  return ses;
}

/** Drops the attempt's cookies and storage once its window is gone. */
function clearAmazonSession(ses: Session): void {
  void ses.clearStorageData().catch(() => {});
  void ses.clearCache().catch(() => {});
}

/**
 * Opens the Amazon window (or returns instantToken in demo) and resolves
 * with an Amazon access token. Rejects on cancel or protocol failure.
 */
export function createAmazonSignIn(deps: AmazonSignInDeps): { signIn(): Promise<string> } {
  // One sign-in window at a time; a second call while it is open is refused.
  let open = false;
  return {
    async signIn() {
      if (deps.instantToken !== undefined) return deps.instantToken;
      if (open) throw new BackendError("eero_error", "Amazon sign-in is already open. Finish or close that window first.");

      const attempt = createAmazonNativeAttempt({
        appVersion: deps.appVersion,
        platform: platformLabel(deps.platform),
      });
      const partition = `${AMAZON_PARTITION_PREFIX}${randomUUID()}`;
      const lifetime = new AbortController();
      open = true;

      return new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          open = false;
          lifetime.abort();
          fn();
        };

        const handleReturn = async (url: string) => {
          try {
            const token = await attempt.exchange(url, lifetime.signal);
            finish(() => resolve(token));
          } catch (err) {
            finish(() =>
              reject(err instanceof BackendError ? err : new BackendError("eero_error", "Amazon could not finish sign-in.")),
            );
          }
        };

        if (deps.openWindow) {
          // Register a dummy session so lockdown helpers stay consistent in tests.
          createAmazonSession(partition);
          const win = deps.openWindow({
            partition,
            signInUrl: attempt.signInUrl,
            onReturn: (url) => {
              void handleReturn(url);
              win.close();
            },
            onCancel: () => finish(() => reject(new BackendError("eero_error", "Amazon sign-in was canceled."))),
            onUnsupported: () =>
              finish(() => reject(new BackendError("eero_error", "Amazon requested an unsupported destination."))),
          });
          lifetime.signal.addEventListener("abort", () => win.close(), { once: true });
          return;
        }

        const parent = deps.parent?.() ?? null;
        const ses = createAmazonSession(partition);
        const options: BrowserWindowConstructorOptions = {
          width: 1080,
          height: 820,
          minWidth: 850,
          minHeight: 650,
          title: "Sign in with Amazon · Mesh UI",
          autoHideMenuBar: true,
          show: true,
          ...(parent ? { parent, modal: true } : {}),
          webPreferences: {
            session: ses,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
          },
        };
        const win = new BrowserWindow(options);

        const onNav = (event: { preventDefault: () => void }, url: string) => {
          if (isAmazonReturnAddress(url)) {
            event.preventDefault();
            if (settled) return;
            win.hide();
            void handleReturn(url).finally(() => {
              if (!win.isDestroyed()) win.close();
            });
            return;
          }
          if (!isAmazonAllowedNavigation(url)) {
            event.preventDefault();
            finish(() => {
              if (!win.isDestroyed()) win.close();
              reject(new BackendError("eero_error", "Amazon requested an unsupported destination."));
            });
          }
        };

        win.webContents.on("will-navigate", onNav);
        win.webContents.on("will-redirect", onNav);
        win.webContents.setWindowOpenHandler(({ url }) => {
          // A pop-up to the return address is the sign-in result: loadURL would skip will-navigate and load it.
          if (isAmazonReturnAddress(url)) onNav({ preventDefault: () => {} }, url);
          else if (isAmazonAllowedNavigation(url)) void win.webContents.loadURL(url);
          return { action: "deny" };
        });
        win.on("closed", () => {
          clearAmazonSession(ses);
          finish(() => reject(new BackendError("eero_error", "Amazon sign-in was canceled.")));
        });

        void win.loadURL(attempt.signInUrl).catch(() => {
          finish(() => {
            if (!win.isDestroyed()) win.close();
            reject(new BackendError("network_error", "Could not open Amazon sign-in. Check your internet connection."));
          });
        });
      });
    },
  };
}

/** True when a partition string is an Amazon native sign-in session. */
export function isAmazonPartition(partition: string | undefined | null): boolean {
  return typeof partition === "string" && partition.startsWith(AMAZON_PARTITION_PREFIX);
}
