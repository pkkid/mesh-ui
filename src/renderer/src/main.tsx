import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { TitleTooltips } from "./components/ui/title-tooltips";
import { applyTheme } from "./lib/themes";
import { applyTrafficColors } from "./lib/trafficColors";
import { trackTitlebarInset } from "./lib/titlebarInset";
import "./index.css";

document.documentElement.dataset.platform = window.mesh.platform;
applyTheme();
applyTrafficColors();
trackTitlebarInset();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <TitleTooltips />
  </StrictMode>,
);
