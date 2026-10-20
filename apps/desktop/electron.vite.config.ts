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
  // The main process gets exactly two build values, MAIN_VITE_SUPABASE_URL and
  // MAIN_VITE_SUPABASE_PUBLISHABLE_KEY, from the environment or apps/desktop/.env.local (git
  // ignored). Both are public by design. The default prefixes would also pass any VITE_ value, so
  // the prefix is narrowed. Without them the build still works and the app is unconfigured.
  main: { envDir: import.meta.dirname, envPrefix: ["MAIN_VITE_SUPABASE_"] },
  preload: {},
  renderer: {
    plugins: [react(), cspMetaTag()],
  },
});
