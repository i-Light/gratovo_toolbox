import { extname, isAbsolute, join, relative, sep } from "node:path";

import { appHost, appScheme } from "./app-page";

const contentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
]);

/** The type a renderer file is served with, by extension; undefined for a type the app doesn't serve. */
export function contentType(file: string): string | undefined {
  return contentTypes.get(extname(file).toLowerCase());
}

/** Maps an app://gratovo/... request to a file inside `root` (the built renderer folder), or undefined. */
export function resolveAppFile(root: string, requestUrl: string): string | undefined {
  if (!URL.canParse(requestUrl)) {
    return undefined;
  }
  // Node's URL.origin is "null" for a custom scheme, so scheme and host are compared directly.
  const { protocol, host, pathname } = new URL(requestUrl);
  if (protocol !== `${appScheme}:` || host !== appHost) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  // The build never names a file with a NUL or a backslash, and on Windows a backslash would act
  // as a path separator that the URL parser didn't see.
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return undefined;
  }

  // Decoding can bring back "..", so the check runs on the joined path, not on the raw URL.
  const file = join(root, decoded);
  const rel = relative(root, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return contentType(file) === undefined ? undefined : file;
}
