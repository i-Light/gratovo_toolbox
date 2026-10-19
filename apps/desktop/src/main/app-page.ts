/** The built page is served from app://gratovo/ (see app-protocol.ts), never from file://. */
export const appScheme = "app";
export const appHost = "gratovo";
export const builtPageUrl = `${appScheme}://${appHost}/index.html`;

/**
 * electron-vite sets the dev server's URL in development. Only an http server on this machine is
 * accepted, so a stray environment variable can't point the app at another site.
 */
export function localDevServer(url: string | undefined): string | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const { protocol, hostname } = new URL(url);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return protocol === "http:" && local ? url : undefined;
}

/** True for the app's own page, whatever its #fragment. */
export function isAppPage(url: string, pageUrl: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const target = new URL(url);
  target.hash = "";
  return target.href === new URL(pageUrl).href;
}

/** True for any URL on the app page's origin: the same scheme, host and port. */
export function isAppOrigin(url: string, pageUrl: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  // Node's URL.origin is "null" for app://, so the parts are compared one by one.
  const target = new URL(url);
  const page = new URL(pageUrl);
  return target.protocol === page.protocol && target.host === page.host;
}

/** The part of Electron's WebFrameMain that the sender check reads. */
export interface SenderFrame {
  readonly url: string;
  readonly parent: unknown;
}

/**
 * True when an IPC call comes from the top frame on the app's origin: not a subframe, not another
 * site. The origin rather than the exact page, because `history.pushState` changes the page's URL
 * without a navigation; the guards in security.ts already keep the frame on the app's page.
 */
export function isTrustedSender(frame: SenderFrame | null, pageUrl: string): boolean {
  return frame !== null && frame.parent === null && isAppOrigin(frame.url, pageUrl);
}
