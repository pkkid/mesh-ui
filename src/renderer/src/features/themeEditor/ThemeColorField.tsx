/**
 * One color row in the theme editor, ported from T3 Code's
 * `ThemeColorPicker.tsx` (MIT): the name (click to show where the color is
 * used), a swatch that opens a picker popover, and a hex field. Escape in
 * the picker reverts the edit.
 */
import { memo, useEffect, useRef, useState } from "react";

import { ColorHueSlider, ColorSaturationValuePlane } from "~/components/ui/color-picker";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { colorToHex, hexToHsv, hsvToHex, parseColor, type Hsv } from "~/lib/themeColor";
import { cn } from "~/lib/utils";

const isColor = (value: string) => parseColor(value) !== null;
const isShortHex = (value: string) => /^#[0-9a-f]{3,4}$/i.test(value.trim());
const toHex = (value: string) => colorToHex(value) ?? "#000000";

function rgbText(hex: string): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].join(", ");
}

function rgbTextToHex(value: string): string | null {
  const channels = value
    .trim()
    .replace(/^rgb\(\s*/i, "")
    .replace(/\s*\)$/, "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (channels.length !== 3 || channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) return null;
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Batches picker drags to one commit per animation frame: a commit can
 * re-derive a whole palette and repaint the window. Flushed on release,
 * close and unmount, so the last frame is never lost.
 */
function createFrameCommitter() {
  let pending: { color: string; commit: (color: string) => void } | null = null;
  let frame: number | null = null;
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const next = pending;
    pending = null;
    next?.commit(next.color);
  };
  return {
    schedule(color: string, commit: (color: string) => void) {
      pending = { color, commit };
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    flush,
  };
}
type FrameCommitter = ReturnType<typeof createFrameCommitter>;

const channelInput =
  "flex min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2 focus-within:border-ring dark:bg-input/32";
const channelLabel = "px-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground";

function PickerPanel({ label, value, committer, onChange }: { label: string; value: string; committer: FrameCommitter; onChange: (value: string) => void }) {
  const hex = toHex(value);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hex));
  const [hexDraft, setHexDraft] = useState(hex);
  const [rgbDraft, setRgbDraft] = useState(() => rgbText(hex));
  const [typing, setTyping] = useState(false);
  const [synced, setSynced] = useState(hex);
  const current = hsvToHex(hsv);

  // The committed value can come back changed (a palette re-derived); follow it, but keep keystrokes while typing.
  if (synced !== hex) {
    setSynced(hex);
    if (!typing) {
      setHexDraft(hex);
      setRgbDraft(rgbText(hex));
    }
    // hex to HSV loses hue and saturation for grays, so only re-read it when the color really moved.
    if (current !== hex) setHsv(hexToHsv(hex));
  }

  const commitHsv = (next: Hsv) => {
    setHsv(next);
    const color = hsvToHex(next);
    setHexDraft(color);
    setRgbDraft(rgbText(color));
    committer.schedule(color, onChange);
  };
  const endTyping = () => {
    setTyping(false);
    setHexDraft(current);
    setRgbDraft(rgbText(current));
  };

  return (
    <div className="w-64">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{label}</p>
          <p className="text-2xs text-muted-foreground">Choose a color</p>
        </div>
        <span className="size-6 shrink-0 rounded-full border border-foreground/10" style={{ backgroundColor: current }} />
      </div>
      <div className="grid gap-3 p-3">
        <ColorSaturationValuePlane label={label} value={hsv} onChange={commitHsv} onInteractionEnd={committer.flush} />
        <ColorHueSlider label={`${label} hue`} value={hsv.h} onChange={(h) => commitHsv({ ...hsv, h })} onInteractionEnd={committer.flush} />
        <div className="grid grid-cols-[1fr_1.2fr] gap-2">
          <label className="grid min-w-0 gap-1">
            <span className={channelLabel}>Hex</span>
            <span className={channelInput}>
              <span className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: current }} />
              <input
                aria-label={`${label} picker hex value`}
                className="h-7 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
                value={hexDraft}
                spellCheck={false}
                onFocus={() => setTyping(true)}
                onBlur={endTyping}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setHexDraft(next);
                  if (!/^#[0-9a-f]{6}$/i.test(next)) return;
                  setHsv(hexToHsv(next));
                  setRgbDraft(rgbText(next));
                  onChange(next.toLowerCase());
                }}
              />
            </span>
          </label>
          <label className="grid min-w-0 gap-1">
            <span className={channelLabel}>RGB</span>
            <span className={channelInput}>
              <input
                aria-label={`${label} picker RGB value`}
                className="h-7 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
                value={rgbDraft}
                spellCheck={false}
                onFocus={() => setTyping(true)}
                onBlur={endTyping}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setRgbDraft(next);
                  const color = rgbTextToHex(next);
                  if (!color) return;
                  setHsv(hexToHsv(color));
                  setHexDraft(color);
                  onChange(color);
                }}
              />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function Swatch({ label, value, onChange, onEditStart, onEditCancel, onInteract }: { label: string; value: string; onChange: (value: string) => void; onEditStart?: () => void; onEditCancel?: () => void; onInteract?: () => void }) {
  const [committer] = useState(createFrameCommitter);
  // Escape reverts the edit, so commits after it (the frame flushed on close) are dropped.
  const canceled = useRef(false);
  // Unmounting with the popover open never fires onOpenChange.
  useEffect(() => committer.flush, [committer]);
  return (
    <Popover
      onOpenChange={(open, details) => {
        canceled.current = !open && details.reason === "escape-key";
        if (open) return onEditStart?.();
        committer.flush();
        if (canceled.current) onEditCancel?.();
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            title={`Choose ${label} color`}
            aria-label={`Choose ${label} color`}
            onFocus={onInteract}
            onPointerDown={onInteract}
            className="relative size-6 shrink-0 cursor-pointer rounded-full border border-foreground/15 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="absolute inset-0 rounded-full" style={{ backgroundColor: value }} />
          </button>
        }
      />
      <PopoverPopup data-theme-editor-panel="" side="bottom" align="end" sideOffset={8}>
        <PickerPanel committer={committer} label={label} value={value} onChange={(next) => !canceled.current && onChange(next)} />
      </PopoverPopup>
    </Popover>
  );
}

export type ThemeColorFieldProps = {
  /** The CSS variable this row edits (`--theme-canvas`, `--series-blue`): its key in the editor. */
  variable: string;
  label: string;
  value: string;
  selected?: boolean;
  onChange: (variable: string, value: string) => void;
  onEditStart?: () => void;
  onEditCancel?: () => void;
  onSelect?: (variable: string) => void;
  onToggleSelected?: (variable: string) => void;
};

export const ThemeColorField = memo(function ThemeColorField({ variable, label, value, selected = false, onChange, onEditStart, onEditCancel, onSelect, onToggleSelected }: ThemeColorFieldProps) {
  const shown = value.trim().toLowerCase().startsWith("#") ? value : toHex(value);
  // While focused the field shows what was typed: a re-derived palette must not overwrite keystrokes.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;
  return (
    <div
      data-theme-color-variable={variable}
      className={cn("flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-2 py-1 transition-colors", selected && "bg-accent")}
    >
      <button
        type="button"
        aria-pressed={selected}
        title={selected ? `Hide where ${label} is used` : `Show where ${label} is used`}
        onClick={() => onToggleSelected?.(variable)}
        className="min-w-0 flex-1 cursor-pointer truncate rounded-md text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
      </button>
      <Swatch
        label={label}
        value={isColor(value) ? value : "#000000"}
        onChange={(next) => onChange(variable, next)}
        onEditStart={onEditStart}
        onEditCancel={onEditCancel}
        onInteract={() => onSelect?.(variable)}
      />
      <span className="inline-flex w-24 shrink-0 items-center rounded-md border border-input bg-background has-aria-invalid:border-destructive/50 has-focus-visible:border-ring dark:bg-input/32">
        <input
          aria-label={`${label} hex value`}
          aria-invalid={!isColor(text)}
          spellCheck={false}
          value={text}
          className="h-6 w-full min-w-0 bg-transparent px-2 font-mono text-2xs text-foreground outline-none"
          onFocus={() => {
            setDraft(shown);
            onSelect?.(variable);
          }}
          onBlur={() => {
            if (draft !== null && isShortHex(draft)) onChange(variable, draft);
            setDraft(null);
          }}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setDraft(next);
            // A short hex is usually a longer one mid-edit, so it commits on blur.
            if (isColor(next) && !isShortHex(next)) onChange(variable, next);
          }}
        />
      </span>
    </div>
  );
});
