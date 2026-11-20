/**
 * Drag a tile (or a stack of selected tiles) onto a drop zone, with a bit of
 * physics so it feels like picking something up: the ghost follows the
 * pointer and wobbles like GNOME's wobbly windows (an underdamped spring on
 * a shear around the grab point: the far edges lag behind a move and
 * jiggle back into shape when the pointer stops), drops
 * into the zone by shrinking toward its centre, and the zone gives a small
 * "gulp". A drop anywhere else springs the ghost back to where it came from.
 * Esc cancels. With reduced motion the ghost just follows and disappears.
 *
 * Zones are any element with `data-drop-zone="<id>"`. Pointer events, not
 * HTML drag and drop, so the ghost is ours to animate. Used by the Unassigned
 * devices section (UnassignedCard.tsx); clicking still selects, because a
 * press only becomes a drag after the pointer moves 5px.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
type Drag<T> = { items: T[]; preview: ReactNode; rect: DOMRect };

const THRESHOLD = 5;
/** Wobble spring: how hard a move kicks the shape, its stiffness, and its damping (low enough to jiggle two or three times). */
const KICK = 0.12;
const STIFF = 0.09;
const DAMP = 0.2;
/** Degrees of shear per pixel of lag, and the most lag allowed. */
const SHEAR = 0.4;
const MAX_LAG = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function useTileDrag<T>({ enabled, onDrop }: { enabled: boolean; onDrop: (items: T[], zone: string) => void }) {
  const [drag, setDrag] = useState<Drag<T> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  // Live pointer and spring state, kept out of React so moves never re-render.
  const m = useRef({ x: 0, y: 0, ox: 0, oy: 0, px: 0, py: 0, wx: 0, wy: 0, wvx: 0, wvy: 0, raf: 0, over: null as string | null, active: false });
  const dragged = useRef(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const place = () => {
    const s = m.current;
    if (ghost.current)
      ghost.current.style.transform = `translate(${s.x - s.ox}px, ${s.y - s.oy}px) skewX(${s.wx * SHEAR}deg) skewY(${s.wy * SHEAR}deg) scale(1.02)`;
  };

  // The wobble: each frame's pointer movement kicks the lag the other way,
  // and an underdamped spring pulls it back to zero, overshooting a little.
  const tick = () => {
    const s = m.current;
    if (!s.active) return;
    const dx = s.x - s.px;
    const dy = s.y - s.py;
    s.px = s.x;
    s.py = s.y;
    if (reducedMotion()) {
      s.wx = s.wy = 0;
    } else {
      s.wvx += -dx * KICK - STIFF * s.wx - DAMP * s.wvx;
      s.wvy += -dy * KICK - STIFF * s.wy - DAMP * s.wvy;
      s.wx = clamp(s.wx + s.wvx, -MAX_LAG, MAX_LAG);
      s.wy = clamp(s.wy + s.wvy, -MAX_LAG, MAX_LAG);
    }
    place();
    s.raf = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!drag) return;
    place();
  }, [drag]);

  useEffect(() => () => cancelAnimationFrame(m.current.raf), []);

  /** Ends a drag: into `zone` (shrink in, gulp, then onDrop) or back home. */
  const finish = (items: T[], rect: DOMRect, zone: string | null) => {
    const s = m.current;
    s.active = false;
    cancelAnimationFrame(s.raf);
    setOver(null);
    const el = ghost.current;
    const from = el?.style.transform ?? "";
    const zoneEl = zone ? document.querySelector<HTMLElement>(`[data-drop-zone="${CSS.escape(zone)}"]`) : null;
    const done = () => {
      setDrag(null);
      if (zone) onDropRef.current(items, zone);
    };
    if (!el || reducedMotion()) return done();
    if (zone && zoneEl) {
      const z = zoneEl.getBoundingClientRect();
      const to = `translate(${z.left + z.width / 2 - rect.width / 2}px, ${z.top + z.height / 2 - rect.height / 2}px) skewX(0deg) skewY(0deg) scale(0.15)`;
      el.animate([{ transform: from, opacity: 1 }, { transform: to, opacity: 0 }], { duration: 280, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)", fill: "forwards" })
        .finished.then(done, done);
      zoneEl.animate(
        [{ transform: "scale(1.03)" }, { transform: "scale(0.96)", offset: 0.35 }, { transform: "scale(1.04)", offset: 0.7 }, { transform: "scale(1)" }],
        { duration: 420, delay: 200, easing: "ease-out" },
      );
    } else {
      // Spring home, overshooting a little.
      const to = `translate(${rect.left}px, ${rect.top}px) skewX(0deg) skewY(0deg) scale(1)`;
      el.animate([{ transform: from }, { transform: to }], { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" }).finished.then(done, done);
    }
  };

  /** Pointer-down handler for a tile: `items` are what the tile carries (itself, or the selection). */
  const press = (e: React.PointerEvent<HTMLElement>, items: () => T[], preview: () => ReactNode) => {
    if (!enabled || e.button !== 0) return;
    const el = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    let current: Drag<T> | null = null;

    const move = (ev: PointerEvent) => {
      const s = m.current;
      if (!current) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        const rect = el.getBoundingClientRect();
        current = { items: items(), preview: preview(), rect };
        Object.assign(s, { ox: sx - rect.left, oy: sy - rect.top, px: ev.clientX, py: ev.clientY, wx: 0, wy: 0, wvx: 0, wvy: 0, over: null, active: true });
        dragged.current = true;
        document.body.style.cursor = "grabbing";
        setDrag(current);
        s.raf = requestAnimationFrame(tick);
      }
      s.x = ev.clientX;
      s.y = ev.clientY;
      const zone = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop-zone]")?.dataset.dropZone ?? null;
      if (zone !== s.over) {
        s.over = zone;
        setOver(zone);
      }
    };
    const end = (cancel: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      document.body.style.cursor = "";
      if (current) finish(current.items, current.rect, cancel ? null : m.current.over);
      // Swallow the click that follows a drag, so dropping does not also toggle selection.
      setTimeout(() => {
        dragged.current = false;
      }, 0);
    };
    const up = () => end(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") end(true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  };

  const count = drag?.items.length ?? 0;
  const layer =
    drag &&
    createPortal(
      <div
        ref={ghost}
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 z-50 will-change-transform"
        style={{ width: drag.rect.width, height: drag.rect.height, transformOrigin: `${m.current.ox}px ${m.current.oy}px` }}
      >
        {/* A stack reads as more than one: two cards fanned out behind. */}
        {count > 1 && (
          <>
            <div className="absolute inset-0 rotate-[-3deg] rounded-[10px] bg-muted shadow-[inset_0_0_0_2px_var(--color-ring)]" />
            <div className="absolute inset-0 rotate-[2deg] rounded-[10px] bg-muted shadow-[inset_0_0_0_2px_var(--color-ring)]" />
          </>
        )}
        <div className="relative h-full rounded-[10px] shadow-lg">{drag.preview}</div>
        {count > 1 && (
          <span className="absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1.5 font-semibold text-2xs text-background tabular-nums">
            {count}
          </span>
        )}
      </div>,
      document.body,
    );

  return {
    /** The ids being dragged, so their tiles can fade in place. */
    dragging: drag ? drag.items : null,
    /** The zone under the pointer. */
    over,
    press,
    /** True for the click that ends a drag. */
    wasDrag: () => dragged.current,
    layer,
  };
}
