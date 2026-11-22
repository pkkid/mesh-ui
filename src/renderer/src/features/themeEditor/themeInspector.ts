/**
 * The theme editor's inspector, ported from T3 Code's `themeInspector.ts`
 * (MIT). Plain DOM code.
 *
 * - **Spotlight:** `highlightVariableUsage` finds every element painted by
 *   some color variables and dims the rest of the window with an SVG mask,
 *   outlining the matches.
 * - **Inspect:** `inspectElement` names the variable that paints the element
 *   under the pointer.
 *
 * Both work by probing: set a variable to a marker color and see whose
 * computed paint changes. Mesh UI works on CSS variables rather than T3's
 * role names, so the chart hues (`--series-*`) are found as well as the
 * theme roles (`--theme-*`); SVG chart marks are outlined by their `<svg>`.
 */
import { SERIES_HUES, THEME_COLOR_ROLES, themeVariable } from "~/lib/themePalettes";

export type PaintKind = "background" | "border" | "foreground";
type PaintSnapshot = Readonly<Record<PaintKind, string>>;
export type ElementInspection = Readonly<{ element: Element; variable: string }>;

const PAINT_KINDS: ReadonlyArray<PaintKind> = ["background", "border", "foreground"];
const MATCH_ATTRIBUTE = "data-theme-inspector-match";
const PROBE_ATTRIBUTE = "data-theme-token-probe";
const PROBE_COLOR = "#01fea7";
const ALTERNATE_PROBE_COLOR = "#fe01a7";
const SPOTLIGHT_ID = "theme-inspector-spotlight";
const SPOTLIGHT_MASK_ID = "theme-inspector-spotlight-mask";
const HOVER_ID = "theme-inspector-hover";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** Elements inside these are the editor itself (and its popovers), never inspected. */
const EDITOR_SELECTOR = "[data-theme-editor-panel]";

/** Every variable the editor can change: the theme roles, then the chart hues. */
export const THEME_VARIABLES: ReadonlyArray<string> = [
  ...THEME_COLOR_ROLES.map(themeVariable),
  ...SERIES_HUES.map((hue) => `--series-${hue}`),
];

/** Mesh UI's Tailwind color tokens (index.css) and the variable each reads. */
const UTILITY_VARIABLES: Readonly<Record<string, string>> = {
  background: "canvas",
  foreground: "text",
  chrome: "chrome",
  card: "surface",
  "card-foreground": "text",
  popover: "surfaceOverlay",
  "popover-foreground": "text",
  tooltip: "canvas",
  "tooltip-foreground": "text",
  "surface-raised": "surfaceRaised",
  primary: "messageAction",
  "primary-foreground": "messageActionForeground",
  secondary: "secondary",
  "secondary-foreground": "secondaryForeground",
  muted: "muted",
  "muted-foreground": "mutedForeground",
  placeholder: "placeholder",
  "secondary-label": "secondaryLabel",
  "icon-muted": "iconMuted",
  accent: "accentSurface",
  "accent-foreground": "accentSurfaceForeground",
  brand: "accent",
  "brand-foreground": "accentForeground",
  border: "border",
  input: "input",
  ring: "focus",
  destructive: "error",
  "destructive-foreground": "errorForeground",
  error: "error",
  "error-foreground": "errorForeground",
  "error-surface": "errorSurface",
  warning: "warning",
  "warning-foreground": "warningForeground",
  "warning-surface": "warningSurface",
  code: "codeBackground",
  "code-foreground": "codeForeground",
  sidebar: "sidebar",
  "sidebar-foreground": "sidebarForeground",
  "sidebar-muted-foreground": "sidebarMutedForeground",
  "sidebar-control": "sidebarControlSurface",
  "sidebar-row-hover": "sidebarRowHover",
  "sidebar-row-active": "sidebarRowActive",
  "sidebar-row-selected": "sidebarRowSelected",
  "sidebar-border": "sidebarBorder",
};

const UTILITY_PREFIXES: Readonly<Record<PaintKind, ReadonlyArray<string>>> = {
  background: ["bg-"],
  border: ["border-", "outline-", "ring-"],
  foreground: ["text-", "fill-", "stroke-"],
};

/** The variable a Tailwind class paints with: `bg-card/40` reads `--theme-surface`; `text-success` a chart hue. */
export function variableFromUtilityClass(className: string, kind: PaintKind): string | null {
  if (className.includes(":")) return null;
  for (const prefix of UTILITY_PREFIXES[kind]) {
    if (!className.startsWith(prefix)) continue;
    const name = className.slice(prefix.length).split("/", 1)[0] ?? "";
    if (name === "success" || name === "success-foreground") return "--series-green";
    if (name === "info" || name === "info-foreground") return "--series-blue";
    const role = UTILITY_VARIABLES[name];
    return role ? themeVariable(role) : null;
  }
  return null;
}

function clearAttribute(attribute: string): void {
  document.querySelectorAll(`[${attribute}]`).forEach((element) => element.removeAttribute(attribute));
}

export function clearInspectorHighlights(): void {
  clearAttribute(MATCH_ATTRIBUTE);
  document.getElementById(SPOTLIGHT_ID)?.remove();
}

export function clearInspectorHover(): void {
  document.getElementById(HOVER_ID)?.remove();
}

const svgElement = <Name extends keyof SVGElementTagNameMap>(name: Name): SVGElementTagNameMap[Name] =>
  document.createElementNS(SVG_NAMESPACE, name);

type Box = { x: number; y: number; width: number; height: number; radius: number };

function boxOf(element: Element): Box | null {
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.right < 0 || bounds.bottom < 0 || bounds.left > window.innerWidth || bounds.top > window.innerHeight) {
    return null;
  }
  const padding = 4;
  const radius = Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius) || 0;
  return {
    x: bounds.left - padding,
    y: bounds.top - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    radius: Math.min(16, Math.max(6, radius + padding)),
  };
}

/** The outline and label over the element the pointer is on, in inspect mode. */
export function showInspectorHover(inspection: ElementInspection, label: string): void {
  const box = boxOf(inspection.element);
  if (!box) return clearInspectorHover();
  let hover = document.getElementById(HOVER_ID);
  if (!hover) {
    hover = document.createElement("div");
    hover.id = HOVER_ID;
    hover.setAttribute("aria-hidden", "true");
    const tag = document.createElement("span");
    tag.dataset.themeInspectorHoverLabel = "";
    hover.append(tag);
    document.body.append(hover);
  }
  Object.assign(hover.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: `${box.radius}px` });
  hover.dataset.placement = box.y < 32 ? "below" : "above";
  const tag = hover.querySelector<HTMLElement>("[data-theme-inspector-hover-label]");
  if (tag) tag.textContent = label;
}

function renderSpotlight(elements: ReadonlyArray<Element>): void {
  const boxes = new Map<string, Box>();
  for (const element of elements) {
    const box = boxOf(element);
    if (box) boxes.set([box.x, box.y, box.width, box.height].map(Math.round).join(":"), box);
  }
  if (boxes.size === 0) {
    document.getElementById(SPOTLIGHT_ID)?.remove();
    return;
  }
  let spotlight = document.getElementById(SPOTLIGHT_ID) as SVGSVGElement | null;
  if (!spotlight) {
    spotlight = svgElement("svg");
    spotlight.id = SPOTLIGHT_ID;
    spotlight.setAttribute("aria-hidden", "true");
    spotlight.setAttribute("focusable", "false");
    document.body.append(spotlight);
  }
  const { innerWidth: width, innerHeight: height } = window;
  spotlight.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const defs = svgElement("defs");
  const mask = svgElement("mask");
  mask.id = SPOTLIGHT_MASK_ID;
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const full = svgElement("rect");
  full.setAttribute("width", String(width));
  full.setAttribute("height", String(height));
  full.setAttribute("fill", "white");
  mask.append(full);
  defs.append(mask);

  const outlines = svgElement("g");
  for (const box of boxes.values()) {
    const hole = svgElement("rect");
    hole.setAttribute("x", String(box.x));
    hole.setAttribute("y", String(box.y));
    hole.setAttribute("width", String(box.width));
    hole.setAttribute("height", String(box.height));
    hole.setAttribute("rx", String(box.radius));
    hole.setAttribute("fill", "black");
    mask.append(hole);
    const outline = hole.cloneNode(false) as SVGRectElement;
    outline.removeAttribute("fill");
    outline.setAttribute("class", "theme-inspector-spotlight-outline");
    outlines.append(outline);
  }
  const dimmer = svgElement("rect");
  dimmer.setAttribute("class", "theme-inspector-spotlight-dimmer");
  dimmer.setAttribute("width", String(width));
  dimmer.setAttribute("height", String(height));
  dimmer.setAttribute("mask", `url(#${SPOTLIGHT_MASK_ID})`);
  spotlight.replaceChildren(defs, dimmer, outlines);
}

/** Redraws the spotlight over the marked elements (after a scroll or resize). */
export function refreshInspectorSpotlight(): void {
  renderSpotlight([...document.querySelectorAll(`[${MATCH_ATTRIBUTE}]`)]);
}

function hasVisibleText(element: Element): boolean {
  if (element.matches("input, textarea, select, option")) return true;
  return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
}

function paintOf(element: Element, { forHitTest = false } = {}): PaintSnapshot | null {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
  const border: string[] = [];
  for (const [color, kind, width] of [
    [style.borderTopColor, style.borderTopStyle, style.borderTopWidth],
    [style.borderRightColor, style.borderRightStyle, style.borderRightWidth],
    [style.borderBottomColor, style.borderBottomStyle, style.borderBottomWidth],
    [style.borderLeftColor, style.borderLeftStyle, style.borderLeftWidth],
  ] as const) {
    if (kind !== "none" && Number.parseFloat(width) > 0) border.push(color);
  }
  if (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) border.push(style.outlineColor);
  if (style.boxShadow !== "none") border.push(style.boxShadow);
  const foreground: string[] = [];
  if (forHitTest || hasVisibleText(element)) foreground.push(style.color);
  if (element instanceof SVGElement) foreground.push(style.fill, style.stroke, style.stopColor);
  if (style.textDecorationLine !== "none") foreground.push(style.textDecorationColor);
  return {
    background: [style.backgroundColor, style.backgroundImage].join("\n"),
    border: border.join("\n"),
    foreground: foreground.join("\n"),
  };
}

const changedKinds = (before: PaintSnapshot, after: PaintSnapshot) => PAINT_KINDS.filter((kind) => before[kind] !== after[kind]);

/** Turns transitions off while probing, so no probe color is ever painted. */
function withProbeSession<T>(run: () => T): T {
  const root = document.documentElement;
  const nested = root.hasAttribute(PROBE_ATTRIBUTE);
  if (!nested) root.setAttribute(PROBE_ATTRIBUTE, "");
  try {
    return run();
  } finally {
    void window.getComputedStyle(root).color;
    if (!nested) root.removeAttribute(PROBE_ATTRIBUTE);
  }
}

function probe(variable: string): () => void {
  const root = document.documentElement;
  const original = root.style.getPropertyValue(variable);
  const priority = root.style.getPropertyPriority(variable);
  root.style.setProperty(variable, original.trim().toLowerCase() === PROBE_COLOR ? ALTERNATE_PROBE_COLOR : PROBE_COLOR, "important");
  return () => {
    if (original) root.style.setProperty(variable, original, priority);
    else root.style.removeProperty(variable);
  };
}

const outsideEditor = (element: Element) => !element.closest(EDITOR_SELECTOR) && !element.closest(`#${SPOTLIGHT_ID}, #${HOVER_ID}`);

/** The element and its ancestors, nearest first, leaving out the editor. */
function ancestry(element: Element): Element[] {
  const out: Element[] = [];
  for (let el: Element | null = element; el && el !== document.documentElement; el = el.parentElement) {
    if (!el.closest(EDITOR_SELECTOR)) out.push(el);
  }
  return out;
}

function variableFromUtilities(element: Element): string | null {
  for (const kind of PAINT_KINDS) {
    for (const className of element.classList) {
      const variable = variableFromUtilityClass(className, kind);
      if (variable) return variable;
    }
  }
  return null;
}

/** The fast path for hovering: the nearest element with a theme color class. */
export function inspectFromUtilities(element: Element): ElementInspection | null {
  if (element.closest(EDITOR_SELECTOR)) return null;
  for (const candidate of ancestry(element)) {
    const variable = variableFromUtilities(candidate);
    if (variable) return { element: candidate, variable };
  }
  return null;
}

/**
 * Marks and spotlights every element whose paint changes when any of
 * `variables` change. Returns how many there are.
 */
export function highlightVariableUsage(variables: ReadonlyArray<string>): number {
  clearAttribute(MATCH_ATTRIBUTE);
  const candidates = [document.body, ...document.body.querySelectorAll("*")].filter(outsideEditor);
  const matches = withProbeSession(() => {
    const baseline = new Map<Element, PaintSnapshot>();
    for (const element of candidates) {
      const snapshot = paintOf(element);
      if (snapshot) baseline.set(element, snapshot);
    }
    const restores = variables.map(probe);
    const changed = new Set<Element>();
    try {
      for (const [element, before] of baseline) {
        const after = paintOf(element);
        if (after && changedKinds(before, after).length > 0) changed.add(element);
      }
    } finally {
      for (const restore of restores.reverse()) restore();
    }
    return changed;
  });
  // A chart's lines, areas and dots are outlined once, as their chart.
  const marked = new Set<Element>();
  for (const element of matches) marked.add(element instanceof SVGElement ? (element.closest("svg") ?? element) : element);
  for (const element of marked) element.setAttribute(MATCH_ATTRIBUTE, "");
  renderSpotlight([...marked]);
  return marked.size;
}

/** The variable that paints `element` or its nearest painted ancestor (background, then border, then text). */
export function inspectElement(element: Element): ElementInspection | null {
  if (element.closest(EDITOR_SELECTOR)) return null;
  const fromClasses = inspectFromUtilities(element);
  if (fromClasses) return fromClasses;
  const candidates = ancestry(element);
  const found = withProbeSession(() => {
    const baseline = new Map<Element, PaintSnapshot>();
    for (const candidate of candidates) {
      const snapshot = paintOf(candidate, { forHitTest: true });
      if (snapshot) baseline.set(candidate, snapshot);
    }
    const byElement = new Map<Element, Partial<Record<PaintKind, string>>>();
    for (const variable of THEME_VARIABLES) {
      const restore = probe(variable);
      try {
        for (const [candidate, before] of baseline) {
          const after = paintOf(candidate, { forHitTest: true });
          if (!after) continue;
          const kinds = byElement.get(candidate) ?? {};
          for (const kind of changedKinds(before, after)) kinds[kind] ??= variable;
          byElement.set(candidate, kinds);
        }
      } finally {
        restore();
      }
    }
    return byElement;
  });
  for (const candidate of candidates) {
    const kinds = found.get(candidate);
    if (!kinds) continue;
    for (const kind of PAINT_KINDS) {
      const variable = kinds[kind];
      if (variable) return { element: candidate, variable };
    }
  }
  return null;
}
