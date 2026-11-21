import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

import { placesModule } from "./scripts/places";

const shared = { "@shared": resolve(__dirname, "src/shared") };

/**
 * `virtual:places`: the search palette's Places index (every page section and
 * settings row), built from the renderer source on every build and dev reload
 * by scripts/places.ts, so it never needs updating by hand.
 */
function places(): Plugin {
  const id = "virtual:places";
  const resolved = `\0${id}`;
  return {
    name: "mesh-ui-places",
    resolveId: (source) => (source === id ? resolved : null),
    load: (moduleId) => (moduleId === resolved ? placesModule(__dirname) : null),
    // In the dev app a changed page rebuilds the index on the next reload.
    handleHotUpdate({ file, server }) {
      if (!file.includes("/src/renderer/src/features/") || !file.endsWith(".tsx")) return;
      const mod = server.moduleGraph.getModuleById(resolved);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    resolve: { alias: shared },
  },
  renderer: {
    resolve: {
      alias: { ...shared, "~": resolve(__dirname, "src/renderer/src") },
    },
    plugins: [react(), tailwindcss(), places()],
  },
});
