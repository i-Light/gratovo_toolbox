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

// The names the build emits: letters, digits, hyphens, underscores and dots, in folders, with no
// segment starting with a dot. Anything else (spaces, backslashes, colons, NUL, "..", dotfiles)
// is refused before the path reaches the disk; on Windows a backslash would be a separator the URL
// parser didn't see, and a colon would name an alternate data stream.
const builtPath = /^(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

// Windows opens these names as devices, with any extension, in any folder.
const deviceName = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;

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
  if (!builtPath.test(decoded) || decoded.split("/").some((part) => deviceName.test(part))) {
    return undefined;
  }

  // The checks above already keep ".." out; this one stays in case they are ever loosened.
  const file = join(root, decoded);
  const rel = relative(root, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return contentType(file) === undefined ? undefined : file;
}
