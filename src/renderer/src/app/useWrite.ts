/**
 * The write kit's logic: how every control runs a write command.
 * docs/ux/overview.md (Confirmations, Toasts) and design/design-system.md#write-kit.
 *
 * `performWrite(request)` runs one write through `execute` and handles what
 * every page would otherwise repeat:
 *
 * 1. Runs the command without `confirm`. For a `disruptive` or `destructive`
 *    command the engine refuses with `needs_confirm` and a message written
 *    for people; that message is shown in the confirm (inline note or
 *    dialog), so the copy lives in core. Only after the person confirms does
 *    it run again with `confirm: true`. Writes the UI confirms on its own
 *    (block a device) pass `ask` and never send `confirm`.
 * 2. Shows a progress toast while a confirmed disruptive command runs.
 * 3. On success: refetches the queries the write affects and shows a success
 *    toast, with Undo when the request names the inverse write.
 * 4. On error: an error toast with Retry; the caller's control keeps its old
 *    state (nothing is applied optimistically here). `bad_params` from a
 *    form lands under its fields instead (`fieldErrors`).
 *
 * `useWrite(id)` wraps it for a component and holds the inline confirm.
 * The palette and other surfaces without room for a note call
 * `performWrite` directly; their confirms open the dialog `ConfirmHost`
 * renders (components/ui/confirm.tsx).
 *
 * Imports are relative (no `~`) so this file runs in node tests.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ExecuteError, ExecuteResult } from "../../../core/errors";
import type { Effect, Network, Permission, Permissions } from "../../../core/model";
import { toast } from "../components/ui/toast";
import { affectedBy, commandInfo, execute, invalidate } from "./useCommand";

// ---------------------------------------------------------------------------
// Confirm requests

/** What a confirm (inline note or dialog) shows. */
export type ConfirmAsk = {
  /** The command being confirmed. */
  id: string;
  effect: Effect;
  /** Names the target: "Restart Maple Street?". Defaults to the command label. */
  title: string;
  /** The consequence; the engine's `needs_confirm` message unless the caller gave one. */
  message: string;
  /** Repeats the action on the danger button: "Yes, restart network". */
  confirmLabel: string;
  /** Destructive actions on a named thing: the person types this to enable the button. */
  typeToConfirm?: string;
};

export type AskFn = (ask: ConfirmAsk) => Promise<boolean>;

type PendingAsk = ConfirmAsk & { resolve: (ok: boolean) => void };

let dialogAsk: PendingAsk | null = null;
const dialogListeners = new Set<() => void>();
const setDialogAsk = (next: PendingAsk | null) => {
  dialogAsk = next;
  dialogListeners.forEach((l) => l());
};

/** Asks through the app-wide confirm dialog (ConfirmHost). A newer ask cancels an open one. */
export const askInDialog: AskFn = (ask) =>
  new Promise<boolean>((resolve) => {
    dialogAsk?.resolve(false);
    setDialogAsk({ ...ask, resolve });
  });

/** Answers the open dialog ask. */
export function answerDialog(ok: boolean): void {
  const current = dialogAsk;
  if (!current) return;
  setDialogAsk(null);
  current.resolve(ok);
}

/** The dialog ask on screen, for ConfirmHost. */
export function useDialogAsk(): ConfirmAsk | null {
  return useSyncExternalStore(
    (l) => (dialogListeners.add(l), () => dialogListeners.delete(l)),
    () => dialogAsk,
  );
}

// ---------------------------------------------------------------------------
// performWrite

export type WriteRequest<P = Record<string, unknown>, R = unknown> = {
  id: string;
  params?: P;
  /** Success toast, past tense with the target: "Paused Leo". Omit for no success toast. */
  success?: string | ((result: R) => string);
  /** The inverse write that Undo runs ("device.resume" after "device.pause"). */
  undo?: WriteRequest | ((result: R) => WriteRequest | null);
  /** Progress toast while a confirmed disruptive command runs: "Restarting Maple Street". */
  progress?: string;
  /** Muted line under the progress toast: "About 2 to 3 minutes". */
  progressDetail?: string;
  /** Confirm copy. `message` overrides the engine's needs_confirm text. */
  confirm?: Partial<Pick<ConfirmAsk, "title" | "message" | "confirmLabel" | "typeToConfirm">>;
  /** A `write` the UI confirms on its own (block a device): ask first, never send `confirm`. */
  askFirst?: boolean;
  /** From a form: `bad_params` goes to the fields, not a toast. */
  form?: boolean;
  /** What failed, for the error toast: "Couldn't pause Leo". Defaults to "Couldn't <label>". */
  failure?: string;
};

export type WriteDeps = {
  execute: (id: string, params?: unknown) => Promise<ExecuteResult>;
  /** The command's effect and label from the registry. */
  info: (id: string) => Promise<{ effect: Effect; label: string } | undefined>;
  ask: AskFn;
  invalidate: (prefixes: ReadonlyArray<string> | undefined) => void;
};

export const defaultDeps: WriteDeps = {
  execute: (id, params) => execute(id, params),
  info: commandInfo,
  ask: askInDialog,
  invalidate,
};

/** The result of a write, or `null` when the person cancelled the confirm. */
export type WriteOutcome<R> = ExecuteResult<R> | null;

const needsConfirm = (effect: Effect) => effect === "disruptive" || effect === "destructive";
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Runs one write with confirm, toasts and refetch. Never throws. `confirmed`
 * is internal: Retry after a confirm repeats the confirmed action.
 */
export async function performWrite<P, R>(
  req: WriteRequest<P, R>,
  deps: WriteDeps = defaultDeps,
  confirmed = false,
): Promise<WriteOutcome<R>> {
  const info = await deps.info(req.id);
  const effect: Effect = info?.effect ?? "write";
  const label = info?.label ?? req.id;
  // `confirm` is only ever added below, after the person confirms.
  const { confirm: _drop, ...base } = { ...(req.params ?? {}) } as Record<string, unknown>;

  const askFor = (message: string) =>
    deps.ask({
      id: req.id,
      effect,
      title: req.confirm?.title ?? `${label}?`,
      message: req.confirm?.message ?? message,
      confirmLabel: req.confirm?.confirmLabel ?? label,
      typeToConfirm: req.confirm?.typeToConfirm,
    });

  if (req.askFirst && !confirmed) {
    if (!(await askFor(""))) return null;
    confirmed = true;
  }

  let progressId: number | null = null;
  const startProgress = () => {
    if (req.progress) progressId = toast.progress(req.progress, { detail: req.progressDetail });
  };

  const withConfirm = confirmed && needsConfirm(effect);
  if (withConfirm) startProgress();
  let res = (await deps.execute(req.id, withConfirm ? { ...base, confirm: true } : base)) as ExecuteResult<R>;
  if (!res.ok && res.error.code === "needs_confirm" && !withConfirm) {
    if (!(await askFor(res.error.message))) return null;
    confirmed = true;
    startProgress();
    res = (await deps.execute(req.id, { ...base, confirm: true })) as ExecuteResult<R>;
  }
  const retry = () => performWrite(req, deps, confirmed);

  if (res.ok) {
    if (effect !== "query") deps.invalidate(affectedBy(req.id));
    const title = typeof req.success === "function" ? req.success(res.result) : req.success;
    const undo = typeof req.undo === "function" ? req.undo(res.result) : req.undo;
    const action = undo ? { label: "Undo", run: () => performWrite({ success: "Undone", ...undo }, deps) } : undefined;
    if (title) {
      if (progressId !== null) toast.update(progressId, "success", { title, action });
      else toast.success(title, { action });
    } else if (progressId !== null) toast.dismiss(progressId);
    return res;
  }

  const { error } = res;
  const quiet = error.code === "not_signed_in" || (req.form && error.code === "bad_params");
  if (quiet) {
    if (progressId !== null) toast.dismiss(progressId);
    return res;
  }
  const title = req.failure ?? `Couldn't ${lower(label)}`;
  const content = { title, detail: errorText(req.id, error), action: { label: "Retry", run: retry } };
  if (progressId !== null) toast.update(progressId, "error", content);
  else toast.error(content.title, content);
  return res;
}

/** How an error reads in a toast (docs/ux/overview.md, error codes table). */
export function errorText(id: string, error: ExecuteError): string {
  if (error.code === "unknown_command") return `Mesh UI could not run ${id}.`;
  if (error.code === "rate_limited") {
    const sec = error.detail?.retryAfterSec;
    return sec ? `eero is rate limiting requests. Try again in ${sec} s.` : "eero is rate limiting requests. Try again shortly.";
  }
  return error.message;
}

/**
 * `bad_params` issues keyed by their first path segment, for messages under
 * form fields: `{ name: "Too long" }`. Empty for any other error.
 */
export function fieldErrors(error: ExecuteError | null | undefined): Record<string, string> {
  if (!error || error.code !== "bad_params") return {};
  const out: Record<string, string> = {};
  for (const issue of error.detail?.issues ?? []) {
    const key = issue.path.split(".")[0] || "_form";
    out[key] ??= issue.message;
  }
  if (Object.keys(out).length === 0) out._form = error.message;
  return out;
}

// ---------------------------------------------------------------------------
// Gates (useGate and GatedButton in components/ui/page.tsx)

export type GateOptions = {
  /** Permission area from network.permissions (`devices`, `eeros`, `profiles`, `settings`, `network`). */
  area?: string;
  /** Which permission the write needs. Default `update`. */
  op?: keyof Permission;
  /** A capability from network.get that must be true (a missing one counts as unsupported). */
  capability?: string;
  /** The control is off in bridge mode (pause, block, profiles, reservations). */
  bridgeOff?: boolean;
};

export type Gate = { allowed: boolean; reason: string | null };

export const NO_PERMISSION = "You don't have permission to change this";
export const BRIDGE_OFF = "Off in bridge mode";
export const NOT_AVAILABLE = "Not available on this network";

/** Pure gate check, for tests and lists that gate many rows from one read. */
export function gateFor(opts: GateOptions, permissions: Permissions | undefined, network: Network | undefined): Gate {
  const { area, op = "update", capability, bridgeOff = false } = opts;
  const bridged = network?.connectionMode === "bridged" || network?.connectionMode === "ipPassthrough";
  if (bridgeOff && bridged) return { allowed: false, reason: BRIDGE_OFF };
  if (capability && network && network.capabilities[capability] !== true) return { allowed: false, reason: NOT_AVAILABLE };
  if (area && permissions) {
    const can = permissions.can[area];
    if (!can || !can[op]) return { allowed: false, reason: permissions.role === "admin" ? "Owner only" : NO_PERMISSION };
  }
  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Hook

export type WriteOptions<P, R> = Omit<WriteRequest<P, R>, "id" | "params">;

export type WriteState<P, R> = {
  /** Runs the write. Resolves with the result, or null if the confirm was cancelled. */
  run: (params?: P, options?: WriteOptions<P, R>) => Promise<WriteOutcome<R>>;
  running: boolean;
  error: ExecuteError | null;
  /** The confirm waiting on the person when `confirmIn` is "inline"; render InlineWriteConfirm. */
  asking: ConfirmAsk | null;
  /** The person confirmed `asking` and the command is running. */
  confirming: boolean;
  answer: (ok: boolean) => void;
};

/**
 * A write for one control. `confirmIn: "inline"` (default) holds the confirm
 * in the hook for an InlineWriteConfirm in place; "dialog" uses the app's
 * confirm dialog (row menus, bulk bars, the topbar).
 */
export function useWrite<P = Record<string, unknown>, R = unknown>(
  id: string,
  defaults: WriteOptions<P, R> & { confirmIn?: "inline" | "dialog" } = {},
): WriteState<P, R> {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ExecuteError | null>(null);
  const [asking, setAskingState] = useState<PendingAsk | null>(null);
  const [confirming, setConfirming] = useState(false);
  const askingRef = useRef<PendingAsk | null>(null);
  const setAsking = (next: PendingAsk | null) => {
    askingRef.current = next;
    setAskingState(next);
  };
  const mounted = useRef(true);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      askingRef.current?.resolve(false);
    };
  }, []);

  const run = useCallback(
    async (params?: P, options: WriteOptions<P, R> = {}) => {
      const { confirmIn = "inline", ...rest } = defaultsRef.current;
      const ask: AskFn =
        confirmIn === "dialog"
          ? askInDialog
          : (a) => new Promise<boolean>((resolve) => (mounted.current ? setAsking({ ...a, resolve }) : resolve(false)));
      setRunning(true);
      setError(null);
      const res = await performWrite<P, R>({ ...rest, ...options, id, params }, { ...defaultDeps, ask });
      if (mounted.current) {
        setRunning(false);
        setAsking(null);
        setConfirming(false);
        setError(res && !res.ok ? res.error : null);
      }
      return res;
    },
    [id],
  );

  const answer = useCallback((ok: boolean) => {
    const current = askingRef.current;
    if (!current) return;
    current.resolve(ok);
    if (ok) setConfirming(true);
    else setAsking(null);
  }, []);

  return { run, running, error, asking, confirming, answer };
}
