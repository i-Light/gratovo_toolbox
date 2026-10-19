import { readFile } from "node:fs/promises";

import { protocol, type Session } from "electron";

import { contentType, resolveAppFile } from "./app-files";
import { appScheme } from "./app-page";
import { contentSecurityPolicy } from "./csp";

/**
 * Runs before the app is ready, when Chromium fixes its schemes. app:// then behaves like https:
 * a secure context with a real origin, so the CSP's 'self' means the app's own files.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// Sent with every response, the 404s included.
const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy(false),
  "X-Content-Type-Options": "nosniff",
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Serves the built renderer from `root` as app://gratovo/. Files are read from disk directly
 * rather than through file://, which the release fuses leave without extra privileges. Only GET
 * requests for known file types inside `root` are answered; everything else is a 404.
 */
export function serveAppFiles(target: Session, root: string): void {
  target.protocol.handle(appScheme, async (request) => {
    const file = request.method === "GET" ? resolveAppFile(root, request.url) : undefined;
    const type = file === undefined ? undefined : contentType(file);
    if (file === undefined || type === undefined) {
      return notFound();
    }
    try {
      return new Response(await readFile(file), {
        headers: { ...securityHeaders, "Content-Type": type },
      });
    } catch {
      return notFound();
    }
  });
}
