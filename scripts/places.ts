/**
 * Places: the search palette's index of every page section and settings row
 * (docs/ux/overview.md, Command palette, Places). Built from the renderer
 * source at build time (the `virtual:places` module in electron.vite.config.ts)
 * so it never needs updating by hand, and checked by places.test.ts.
 *
 * It reads each feature file with Vite's parser and keeps every `<Section>`,
 * `<Group>`, settings `<Row>` (or `SettingsRow`) and `<ToggleRow>` whose
 * title is plain text: a string, or a fragment that starts with text
 * (`<>Legacy mode{...}</>`). Titles built at runtime are skipped.
 *
 * Conditional places: an element rendered only sometimes (inside `&&`, `?:`,
 * after an early `return`, or in a component the page renders only
 * sometimes) must say when with a `when` prop naming a rule in
 * src/renderer/src/features/palette/placeRules.ts; the page and Places use
 * that same rule. `unconditioned` lists the ones that do not, and the test
 * fails on them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { parseAst } from "vite";

import { placeSlug } from "../src/shared/places";

export type PlaceKind = "section" | "setting";

export type ScannedPlace = {
  /** The page's route id (routes.ts). */
  route: string;
  title: string;
  kind: PlaceKind;
  /** `data-place` value the element renders with (placeSlug of its title). */
  anchor: string;
  /** Rule name from the `when` prop, if any. */
  when: string | null;
  /** Rendered only sometimes on its page (a condition in the source). */
  conditional: boolean;
  file: string;
};

/** Which page a feature file's sections belong to. Detail pages (one eero, device, profile) and dialogs are left out. */
const FOLDER_ROUTE: Record<string, string> = {
  overview: "overview",
  internet: "internet",
  eeros: "eeros",
  devices: "devices",
  profiles: "profiles",
  signal: "signal",
  activity: "activity",
  wifi: "wifi",
  guest: "guest",
  advanced: "advanced",
  ports: "ports",
  updates: "updates",
  troubleshooting: "troubleshooting",
};
/** The account folder holds both Account and Settings. */
const SETTINGS_FILES = new Set(["SettingsPage.tsx", "SettingsHero.tsx", "ThemePicker.tsx", "CliAgents.tsx"]);

const SECTION_TAGS = new Set(["Section", "Group"]);
const ROW_TAGS = new Set(["Row", "SettingsRow", "ToggleRow"]);


function routeFor(file: string): string | null {
  const parts = file.split("/");
  const folder = parts[parts.length - 2] ?? "";
  const name = parts[parts.length - 1] ?? "";
  if (folder === "account") return SETTINGS_FILES.has(name) ? "settings" : "account";
  return FOLDER_ROUTE[folder] ?? null;
}

type Node = { type: string; [k: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string";

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const k of Object.keys(n)) {
    if (k === "parent") continue;
    const v = n[k];
    if (Array.isArray(v)) for (const c of v) isNode(c) && out.push(c);
    else if (isNode(v)) out.push(v);
  }
  return out;
}

const tagName = (el: Node): string | null => {
  const name = (el.openingElement as Node | undefined)?.name as Node | undefined;
  return name?.type === "JSXIdentifier" ? String(name.name) : null;
};

const attr = (el: Node, key: string): Node | null => {
  const attrs = ((el.openingElement as Node).attributes as Node[]) ?? [];
  return (attrs.find((a) => a.type === "JSXAttribute" && (a.name as Node).name === key) as Node | undefined) ?? null;
};

/** The plain text of a title attribute, or null when it is built at runtime. */
function titleText(a: Node | null): string | null {
  const v = a?.value as Node | undefined;
  if (!v) return null;
  if (v.type === "Literal" && typeof v.value === "string") return v.value.trim() || null;
  if (v.type !== "JSXExpressionContainer") return null;
  const e = v.expression as Node;
  if (e.type === "Literal" && typeof e.value === "string") return e.value.trim() || null;
  if (e.type === "TemplateLiteral" && (e.expressions as Node[]).length === 0) return String(((e.quasis as Node[])[0]?.value as { cooked: string }).cooked).trim() || null;
  if (e.type === "JSXFragment" || e.type === "JSXElement") {
    // `<>Legacy mode{...}</>`: the first child must be text for the title to be known.
    const first = (e.children as Node[]).find((c) => !(c.type === "JSXText" && String(c.value).trim() === ""));
    return first?.type === "JSXText" ? String(first.value).trim() || null : null;
  }
  return null;
}

const stringAttr = (a: Node | null): string | null => {
  const v = a?.value as Node | undefined;
  return v?.type === "Literal" && typeof v.value === "string" ? v.value : null;
};

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

/** The component an element is defined in: the nearest named function (or const arrow) around it. */
function componentOf(path: Node[]): { name: string | null; fn: Node | null } {
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i] as Node;
    if (n.type === "FunctionDeclaration") return { name: String((n.id as Node | null)?.name ?? ""), fn: n };
    if (FUNCTION_TYPES.has(n.type)) {
      const p = path[i - 1];
      if (p?.type === "VariableDeclarator") return { name: String((p.id as Node).name), fn: n };
    }
  }
  return { name: null, fn: null };
}

/**
 * A condition about load errors (`query.error && !data ? <SectionError/> : ...`) is not a show-if rule: the place is
 * there whenever the page has its data. Those are ignored.
 */
const isErrorTest = (test: Node | undefined, src: string): boolean => !!test && /\berror\b/i.test(src.slice(test.start as number, test.end as number));

/** True when the element sits under `&&`, `||`, `??` or `?:` inside its own component (load-error branches aside). */
function underCondition(path: Node[], src: string): boolean {
  for (let i = path.length - 1; i > 0; i--) {
    const n = path[i] as Node;
    if (FUNCTION_TYPES.has(n.type)) return false;
    const p = path[i - 1] as Node;
    if (p.type === "LogicalExpression" && p.right === n && !isErrorTest(p.left as Node, src)) return true;
    if (p.type === "ConditionalExpression" && (p.consequent === n || p.alternate === n) && !isErrorTest(p.test as Node, src)) return true;
  }
  return false;
}

/** True when the component body has an `if (...) return` (not a load-error one) before the statement holding the element. */
function afterEarlyReturn(fn: Node | null, el: Node, src: string): boolean {
  const body = fn?.body as Node | undefined;
  if (!body || body.type !== "BlockStatement") return false;
  const start = el.start as number;
  return (body.body as Node[]).some((st) => st.type === "IfStatement" && (st.end as number) < start && containsReturn(st) && !isErrorTest(st.test as Node, src));
}

function containsReturn(n: Node): boolean {
  if (n.type === "ReturnStatement") return true;
  if (FUNCTION_TYPES.has(n.type)) return false;
  return children(n).some(containsReturn);
}

type Found = { file: string; route: string; el: Node; component: string | null; local: boolean };

function walkFile(src: string, onElement: (el: Node, path: Node[]) => void): void {
  const ast = parseAst(src, { lang: "tsx" } as never) as unknown as Node;
  const path: Node[] = [];
  const visit = (n: Node) => {
    path.push(n);
    if (n.type === "JSXElement") onElement(n, path);
    for (const c of children(n)) visit(c);
    path.pop();
  };
  visit(ast);
}

/**
 * Whether a component is rendered only sometimes on a page: every place the page renders it is under a condition,
 * and they are not simply the two sides of one `?:` (Overview's eeros list is in both its bridge and router layouts).
 */
function conditionalOn(uses: { route: string; conditional: boolean }[] | undefined, route: string): boolean {
  const here = (uses ?? []).filter((u) => u.route === route);
  if (here.length === 0 || here.some((u) => !u.conditional)) return false;
  return here.length === 1;
}

function featureFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Scans `src/renderer/src/features` (relative to `repo`) and returns every
 * place, plus the names of components the pages render only sometimes.
 */
export function scanPlaces(repo: string): ScannedPlace[] {
  const root = join(repo, "src/renderer/src/features");
  const files = featureFiles(root);
  const found: Found[] = [];
  // Components a page renders under a condition (component name to the routes where it is): their places are
  // conditional on those pages too. A component shown both ways round (`bridged ? <A/> : <A/>`) is not.
  const usages = new Map<string, { route: string; conditional: boolean }[]>();
  for (const abs of files) {
    const file = relative(repo, abs);
    const src = readFileSync(abs, "utf8");
    const route = routeFor(file);
    walkFile(src, (el, path) => {
      const tag = tagName(el);
      if (!tag) return;
      const { fn, name } = componentOf(path);
      const local = underCondition(path, src) || afterEarlyReturn(fn, el, src);
      if (/^[A-Z]/.test(tag) && route) {
        const list = usages.get(tag) ?? [];
        list.push({ route, conditional: local });
        usages.set(tag, list);
      }
      if (route && (SECTION_TAGS.has(tag) || ROW_TAGS.has(tag))) found.push({ file, route, el, component: name, local });
    });
  }
  const places: ScannedPlace[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const tag = tagName(f.el) as string;
    const title = titleText(attr(f.el, "title"));
    if (!title) continue;
    const kind: PlaceKind = SECTION_TAGS.has(tag) ? "section" : "setting";
    const anchor = placeSlug(title);
    const key = `${f.route}|${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      route: f.route,
      title,
      kind,
      anchor,
      when: stringAttr(attr(f.el, "when")),
      conditional: f.local || (f.component !== null && conditionalOn(usages.get(f.component), f.route)),
      file: f.file,
    });
  }
  return places;
}

/** The places the build ships: route, title, kind, anchor and rule (no file paths). */
export function placesModule(repo: string): string {
  const list = scanPlaces(repo).map(({ route, title, kind, anchor, when }) => ({ route, title, kind, anchor, when }));
  return `export default ${JSON.stringify(list)};`;
}
