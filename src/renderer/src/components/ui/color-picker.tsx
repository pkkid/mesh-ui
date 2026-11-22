/**
 * Color picking surfaces, ported from T3 Code's
 * `components/ui/color-picker.tsx` (MIT): a saturation and brightness plane
 * and a hue slider, both draggable and keyboard operable.
 */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import type { Hsv } from "~/lib/themeColor";
import { cn } from "~/lib/utils";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function useColorDrag(
  update: (event: PointerEvent<HTMLDivElement>) => void,
  onInteractionEnd?: () => void,
  focusTarget?: RefObject<HTMLElement | null>,
) {
  const [dragging, setDragging] = useState(false);
  const pointerId = useRef<number | null>(null);
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    setDragging(false);
    onInteractionEnd?.();
  };
  return {
    thumbTransition: dragging ? undefined : "left 80ms linear, top 80ms linear, background-color 80ms linear",
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (pointerId.current !== null || event.button !== 0) return;
        pointerId.current = event.pointerId;
        (focusTarget?.current ?? event.currentTarget).focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        update(event);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (pointerId.current === event.pointerId) update(event);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
    },
  };
}

type ColorControlProps<T> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  onInteractionEnd?: () => void;
  className?: string;
};

export function ColorSaturationValuePlane({ label, value, onChange, onInteractionEnd, className }: ColorControlProps<Hsv>) {
  const instructionsId = useId();
  const saturationRef = useRef<HTMLInputElement>(null);
  const { handlers, thumbTransition } = useColorDrag(
    (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      onChange({
        ...value,
        s: clamp((event.clientX - bounds.left) / bounds.width),
        v: 1 - clamp((event.clientY - bounds.top) / bounds.height),
      });
    },
    onInteractionEnd,
    saturationRef,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, axis: "s" | "v") => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? clamp(value[axis] + step)
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? clamp(value[axis] - step)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange({ ...value, [axis]: next });
  };

  return (
    <div
      aria-label={`${label} saturation and brightness`}
      role="group"
      className={cn(
        "relative h-32 cursor-crosshair touch-none overflow-hidden rounded-lg bg-[linear-gradient(to_top,#000,transparent),linear-gradient(to_right,#fff,transparent)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        className,
      )}
      style={{ backgroundColor: `hsl(${value.h} 100% 50%)` }}
      {...handlers}
    >
      <span id={instructionsId} className="sr-only">
        Use arrow keys to adjust the focused value. Hold Shift for larger steps. Press Tab to move between saturation and
        brightness.
      </span>
      {(
        [
          ["s", `${label} saturation`],
          ["v", `${label} brightness`],
        ] as const
      ).map(([axis, axisLabel]) => (
        <input
          key={axis}
          ref={axis === "s" ? saturationRef : undefined}
          type="range"
          min={0}
          max={100}
          step="any"
          value={value[axis] * 100}
          aria-label={axisLabel}
          aria-describedby={instructionsId}
          aria-valuetext={`${Math.round(value[axis] * 100)}%`}
          className="sr-only"
          onKeyDown={(event) => onKeyDown(event, axis)}
          onChange={(event) => onChange({ ...value, [axis]: event.currentTarget.valueAsNumber / 100 })}
        />
      ))}
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        style={{
          left: `calc(${value.s} * (100% - 0.75rem) + 0.375rem)`,
          top: `calc(${1 - value.v} * (100% - 0.75rem) + 0.375rem)`,
          transition: thumbTransition,
        }}
      />
    </div>
  );
}

export function ColorHueSlider({ label, value, onChange, onInteractionEnd, className }: ColorControlProps<number>) {
  const { handlers, thumbTransition } = useColorDrag((event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    onChange(clamp((event.clientX - bounds.left) / bounds.width) * 360);
  }, onInteractionEnd);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onChange(event.key === "Home" ? 0 : 360);
      return;
    }
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    onChange((value + direction * (event.shiftKey ? 10 : 1) + 360) % 360);
  };

  return (
    <div
      aria-label={label}
      aria-valuemax={360}
      aria-valuemin={0}
      aria-valuenow={Math.round(value)}
      role="slider"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex h-6 cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="h-2.5 w-full rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] shadow-[inset_0_0_0_1px_rgb(0_0_0_/_12%)]"
      />
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        style={{
          left: `calc(${value / 360} * (100% - 1rem) + 0.5rem)`,
          backgroundColor: `hsl(${value} 100% 50%)`,
          transition: thumbTransition,
        }}
      />
    </div>
  );
}
