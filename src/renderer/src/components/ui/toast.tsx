// Toasts from docs/ux/overview.md#toasts: bottom right of the main pane,
// stacked, at most 3, glass cards, aria-live. A module-level store so a write
// started anywhere (a page, the palette, Copy) can show one without a
// provider: `toast.success("Paused Leo", { action: { label: "Undo", run } })`.
//
// - success: 4 s, optional action (Undo).
// - progress: kept until `toast.update` replaces it with the result.
// - error: kept until dismissed, optional action (Retry).
//
// Imports are relative so the store also loads in node tests (useWrite.test).
import { CircleAlert, CircleCheck, LoaderCircle, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "../../lib/utils";

/** Plain buttons (not ui/button) so this file loads in node tests without the `~` alias. */
const SMALL_BUTTON =
  "-my-0.5 inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[var(--control-radius)] border border-input bg-popover px-2 font-medium text-foreground text-xs outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32 dark:hover:bg-input/64";
const ICON_BUTTON =
  "-my-0.5 -me-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export type ToastKind = "success" | "progress" | "error";

export type ToastAction = { label: string; run: () => unknown };

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  /** A muted second line (eero's message, a duration). */
  detail?: string;
  action?: ToastAction;
};

export type ToastInput = Omit<Toast, "id" | "kind">;

export const MAX_TOASTS = 3;
export const SUCCESS_MS = 4000;

let list: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function arm(t: Toast) {
  clearTimeout(timers.get(t.id));
  timers.delete(t.id);
  if (t.kind === "success") timers.set(t.id, setTimeout(() => dismiss(t.id), SUCCESS_MS));
}

/** An action runs once: it dismisses its toast first, so Retry or Undo cannot repeat. */
function once(id: number, action: ToastAction | undefined): ToastAction | undefined {
  return action && { label: action.label, run: () => (dismiss(id), action.run()) };
}

function show(kind: ToastKind, input: ToastInput): number {
  const id = nextId++;
  const t: Toast = { ...input, kind, id, action: once(id, input.action) };
  // Newest last; the oldest drop off past the cap.
  const next = [...list, t];
  for (const old of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimeout(timers.get(old.id));
  list = next.slice(-MAX_TOASTS);
  arm(t);
  emit();
  return t.id;
}

/** Replaces a toast in place (a progress toast becoming its result). Shows a new one if it is gone. */
function update(id: number, kind: ToastKind, input: ToastInput): number {
  if (!list.some((t) => t.id === id)) return show(kind, input);
  const t: Toast = { ...input, kind, id, action: once(id, input.action) };
  list = list.map((x) => (x.id === id ? t : x));
  arm(t);
  emit();
  return id;
}

function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, rest: Omit<ToastInput, "title"> = {}) => show("success", { title, ...rest }),
  progress: (title: string, rest: Omit<ToastInput, "title"> = {}) => show("progress", { title, ...rest }),
  error: (title: string, rest: Omit<ToastInput, "title"> = {}) => show("error", { title, ...rest }),
  update,
  dismiss,
  /** The toasts on screen, oldest first. */
  list: (): readonly Toast[] => list,
  /** Removes every toast (tests). */
  clear: () => {
    for (const id of timers.keys()) clearTimeout(timers.get(id));
    timers.clear();
    list = [];
    emit();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(toast.subscribe, toast.list);
}

const ICON = { success: CircleCheck, progress: LoaderCircle, error: CircleAlert } as const;

/** One toast card. Exported for the gallery, which shows each kind in place. */
export function ToastCard({ t, onDismiss }: { t: Toast; onDismiss?: () => void }) {
  const Icon = ICON[t.kind];
  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      data-slot="toast"
      data-kind={t.kind}
      className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl border border-border/50 bg-popover/95 px-3 py-2.5 text-popover-foreground text-xs shadow-lg backdrop-blur-sm"
    >
      <Icon
        className={cn(
          "mt-px size-4 shrink-0",
          t.kind === "success" && "text-success-foreground",
          t.kind === "error" && "text-destructive-foreground",
          t.kind === "progress" && "animate-spin text-muted-foreground motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{t.title}</div>
        {t.detail && <div className="mt-0.5 text-muted-foreground">{t.detail}</div>}
      </div>
      {t.action && (
        <button type="button" className={SMALL_BUTTON} onClick={() => void t.action?.run()}>
          {t.action.label}
        </button>
      )}
      {t.kind !== "progress" && onDismiss && (
        <button type="button" aria-label="Dismiss" className={ICON_BUTTON} onClick={onDismiss}>
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** The stack, mounted once by App.tsx. Bottom right of the window, over the main pane. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      data-slot="toaster"
      className="no-drag pointer-events-none fixed end-4 bottom-4 z-[60] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          t={t}
          onDismiss={() => {
            dismiss(t.id);
          }}
        />
      ))}
    </div>
  );
}
