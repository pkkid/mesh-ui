/**
 * Copies text and says so in a toast (docs/ux/overview.md#toasts): "Copied",
 * or the page's own wording ("Copied password"), and an error toast when the
 * copy failed. Pass `toast: false` where the control shows its own state.
 *
 * The app denies web permission checks (src/main/index.ts), which can refuse
 * the async Clipboard API, so fall back to a selected textarea and
 * `execCommand("copy")`, which needs only the click's user gesture.
 */
import { toast } from "../components/ui/toast";

export async function copyText(text: string, opts: { toast?: string | false } = {}): Promise<boolean> {
  const ok = await copy(text);
  if (opts.toast !== false) {
    if (ok) toast.success(opts.toast ?? "Copied");
    else toast.error("Couldn't copy", { detail: "The clipboard refused the text." });
  }
  return ok;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.append(el);
    el.select();
    try {
      return document.execCommand("copy");
    } finally {
      el.remove();
    }
  }
}
