import "@gratovo/ui/tokens.css";
import "@gratovo/ui/fonts.css";
import "@gratovo/ui/base.css";
import "@gratovo/ui/controls.css";
import "@gratovo/ui/motion.css";
import "./app/auth.css";
import "./app/frame.css";
import "./app/load-failed.css";
import "./app/save-state.css";
import "./find/find.css";
import "./overlays/overlays.css";
import "./prototype/prototype.css";
import "./reach/reach.css";
import "./record/emails.css";
import "./record/record.css";
import "./settings/settings.css";
import "./toolbox/toolbox.css";

import { createRoot } from "react-dom/client";

import { startApp } from "./app/start";
import { initPrefs } from "./lib/prefs";
import { strings } from "./strings";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}

document.title = strings.appName;
initPrefs();

const root = createRoot(container);
await startApp(root, window.gratovo.invoke);
