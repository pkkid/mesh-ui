/**
 * Copies text. The app denies web permission checks (src/main/index.ts), which
 * can refuse the async Clipboard API, so fall back to a selected textarea and
 * `execCommand("copy")`, which needs only the click's user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
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
