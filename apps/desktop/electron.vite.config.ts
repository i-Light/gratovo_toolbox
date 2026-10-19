import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

import { contentSecurityPolicy } from "./src/main/csp";

/** Writes the policy into index.html as a meta tag, so it applies before any script runs. */
function cspMetaTag(): Plugin {
  let dev = false;
  return {
    name: "gratovo:csp-meta-tag",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy(dev) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

// The package has no "type": "module", so the preload builds as CommonJS: a sandboxed preload
// can't be an ES module.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), cspMetaTag()],
  },
});
