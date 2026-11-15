import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyTheme } from "./lib/themes";
import { trackTitlebarInset } from "./lib/titlebarInset";
import "./index.css";

document.documentElement.dataset.platform = window.mesh.platform;
applyTheme();
trackTitlebarInset();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
