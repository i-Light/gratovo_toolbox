import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

/**
 * The renderer's Content Security Policy. The built app may load only its own files. The dev
 * server also needs inline scripts and styles (Vite injects the React refresh preamble and CSS
 * that way) and its websocket for hot reload; none of that reaches a build.
 */
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

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

export default defineConfig({
  main: {},
  renderer: {
    plugins: [react(), cspMetaTag()],
  },
});
