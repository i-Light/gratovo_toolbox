import "@gratovo/ui/tokens.css";
import "@gratovo/ui/fonts.css";
import "@gratovo/ui/base.css";
import "@gratovo/ui/controls.css";
import "@gratovo/ui/motion.css";
import "./app/frame.css";
import "./overlays/overlays.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import { loadMyName } from "./lib/actions";
import { initPrefs } from "./lib/prefs";
import { installHashSync } from "./lib/store";
import { strings } from "./strings";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}

document.title = strings.appName;
initPrefs();
loadMyName();
installHashSync();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
