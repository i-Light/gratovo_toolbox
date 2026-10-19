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

/** The part of Electron's WebFrameMain that the sender check reads. */
export interface SenderFrame {
  readonly url: string;
  readonly parent: unknown;
}

/** True when an IPC call comes from the app page's top frame: not a subframe, not another page. */
export function isTrustedSender(frame: SenderFrame | null, pageUrl: string): boolean {
  return frame !== null && frame.parent === null && isAppPage(frame.url, pageUrl);
}
