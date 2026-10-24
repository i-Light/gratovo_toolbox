/**
 * The renderer's Content Security Policy. The built app may load only its own files. The dev
 * server also needs inline scripts and styles (Vite injects the React refresh preamble and CSS
 * that way) and its websocket for hot reload; none of that reaches a build. The build writes it
 * into the page (electron.vite.config.ts) and app-protocol.ts also sends it as a header.
 */
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    // In dev the page comes from the Vite server, so the app's own pictures (app://gratovo/img/…)
    // are not 'self' there.
    `img-src 'self' data:${dev ? " app://gratovo" : ""}`,
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
