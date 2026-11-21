/** The search palette's Places index, built from the renderer source (electron.vite.config.ts, scripts/places.ts). */
declare module "virtual:places" {
  const places: ReadonlyArray<{ route: string; title: string; kind: "section" | "setting"; anchor: string; when: string | null }>;
  export default places;
}
