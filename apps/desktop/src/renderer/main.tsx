import "@gratovo/ui/tokens.css";
import "./base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { strings } from "./strings";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}

document.title = strings.appName;

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
