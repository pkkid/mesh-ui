/**
 * Draws every `title` attribute in the window as a themed tooltip, in the
 * same surface as the chart tooltips, instead of the OS tooltip. Mounted
 * once at the app root, so components keep writing plain `title="..."`.
 *
 * While the pointer is over an element with a title, the attribute is moved
 * aside (so the native tooltip does not also show) and put back when the
 * pointer leaves. If the app changes the title meanwhile ("Copy" to
 * "Copied"), the tooltip follows it.
 */
import { useEffect, useState } from "react";

import { FloatingTooltip } from "~/components/charts/Tooltip";

/** Wait before the first tooltip, like the OS does. */
const OPEN_DELAY = 500;
/** Moving to another titled element within this long shows its tooltip at once. */
const WARM_WINDOW = 400;

type Tip = { text: string; anchor: { left: number; top: number; width: number; height: number } };

export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let el: Element | null = null;
    let text = "";
    let shown = false;
    let lastHidden = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | null = null;

    const show = () => {
      if (el === null || !el.isConnected) return release();
      const r = el.getBoundingClientRect();
      shown = true;
      setTip({ text, anchor: { left: r.left, top: r.top, width: r.width, height: r.height } });
    };

    function release() {
      clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      if (el !== null && !el.hasAttribute("title")) el.setAttribute("title", text);
      el = null;
      if (shown) lastHidden = Date.now();
      shown = false;
      setTip(null);
    }

    const take = (target: Element) => {
      el = target;
      text = target.getAttribute("title") ?? "";
      target.removeAttribute("title");
      observer = new MutationObserver(() => {
        const next = el?.getAttribute("title");
        if (el === null || next === null || next === undefined) return;
        text = next;
        el.removeAttribute("title");
        if (shown) show();
      });
      observer.observe(target, { attributes: true, attributeFilter: ["title"] });
      timer = setTimeout(show, Date.now() - lastHidden < WARM_WINDOW ? 0 : OPEN_DELAY);
    };

    const onOver = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const titled = event.target.closest("[title]");
      // Still inside the current element (its title is moved aside, so closest skips it).
      if (el !== null && el.contains(event.target) && !(titled !== null && el.contains(titled))) return;
      release();
      if (titled !== null && titled.getAttribute("title")?.trim()) take(titled);
    };
    const onLeaveWindow = (event: PointerEvent) => {
      if (event.relatedTarget === null) release();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onLeaveWindow, true);
    document.addEventListener("pointerdown", release, true);
    document.addEventListener("keydown", release, true);
    document.addEventListener("scroll", release, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onLeaveWindow, true);
      document.removeEventListener("pointerdown", release, true);
      document.removeEventListener("keydown", release, true);
      document.removeEventListener("scroll", release, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  if (tip === null) return null;
  return (
    <FloatingTooltip at={{ anchor: tip.anchor }} className="max-w-80 whitespace-pre-line text-balance">
      {tip.text}
    </FloatingTooltip>
  );
}
