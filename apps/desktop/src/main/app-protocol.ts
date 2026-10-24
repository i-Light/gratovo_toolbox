import { readFile } from "node:fs/promises";

import { protocol, type Session } from "electron";

import { contentType, resolveAppFile } from "./app-files";
import { appHost, appScheme } from "./app-page";
import { contentSecurityPolicy } from "./csp";
import type { ImageService } from "./find/images";

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

const imagePrefix = "/img/";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export interface AppFilesDeps {
  /** Answers app://gratovo/img/<key> (plan D9). Without it those requests are files like any other. */
  images?: ImageService;
}

/** The picture key in an app://gratovo/img/<key> request, decoded once; undefined for anything else. */
function imageKey(requestUrl: string): string | undefined {
  if (!URL.canParse(requestUrl)) {
    return undefined;
  }
  // Node's URL.origin is "null" for a custom scheme, so scheme and host are compared directly.
  const { protocol: scheme, host, pathname } = new URL(requestUrl);
  if (scheme !== `${appScheme}:` || host !== appHost || !pathname.startsWith(imagePrefix)) {
    return undefined;
  }
  try {
    return decodeURIComponent(pathname.slice(imagePrefix.length));
  } catch {
    return undefined;
  }
}

/** One app:// request, answered. Kept apart from Electron so the tests can call it. */
export async function answerAppRequest(
  request: Request,
  root: string,
  deps: AppFilesDeps = {},
): Promise<Response> {
  if (request.method !== "GET") {
    return notFound();
  }
  const key = deps.images === undefined ? undefined : imageKey(request.url);
  if (deps.images !== undefined && key !== undefined) {
    // The service checks the key's shape; a bad one is a 404 like a missing picture.
    const image = await deps.images.get(key).catch(() => ({ status: 404 }) as const);
    if (image.status !== 200) {
      return notFound();
    }
    return new Response(image.body, {
      headers: {
        ...securityHeaders,
        "Content-Type": image.type,
        "Cache-Control": "max-age=86400",
      },
    });
  }
  const file = resolveAppFile(root, request.url);
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
}

/**
 * Serves the built renderer from `root` as app://gratovo/, and the Find pictures as
 * app://gratovo/img/<key> when `deps.images` is given. Files are read from disk directly rather
 * than through file://, which the release fuses leave without extra privileges. Only GET requests
 * for known file types inside `root` are answered; everything else is a 404.
 */
export function serveAppFiles(target: Session, root: string, deps: AppFilesDeps = {}): void {
  target.protocol.handle(appScheme, (request) => answerAppRequest(request, root, deps));
}
