import "@gratovo/ui/tokens.css";
import "@gratovo/ui/fonts.css";
import "@gratovo/ui/base.css";
import "@gratovo/ui/controls.css";
import "@gratovo/ui/motion.css";
import "./app/frame.css";
import "./app/load-failed.css";
import "./app/save-failed.css";
import "./overlays/overlays.css";
import "./settings/settings.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import { toAppData } from "./lib/frame";
import { installPersistence } from "./lib/persist";
import { initPrefs } from "./lib/prefs";
import { routeFromHash } from "./lib/routes";
import { initAppStore, installHashSync } from "./lib/store";
import { strings } from "./strings";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}

document.title = strings.appName;
initPrefs();

const root = createRoot(container);
const loaded = await window.gratovo.invoke("frame:load", {});
if (loaded.ok) {
  initAppStore(toAppData(loaded.value), routeFromHash(location.hash));
  // From here on every change to the data is written back; what was just loaded counts as saved.
  installPersistence(window.gratovo.invoke);
  installHashSync();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  // The reason is logged in the main process; the page only says what to do.
  root.render(
    <main className="load-failed" role="alert">
      <h1>{strings.loadFailed.title}</h1>
      <p>{strings.loadFailed.sub}</p>
    </main>,
  );
}
