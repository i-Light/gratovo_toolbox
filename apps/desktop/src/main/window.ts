import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow, app } from "electron";

const indexHtml = join(__dirname, "../renderer/index.html");

/**
 * electron-vite sets this in development. A packaged app ignores it, and a local run accepts only
 * a dev server on this machine, so a stray environment variable can't point the app elsewhere.
 */
const devServerUrl = app.isPackaged
  ? undefined
  : localDevServer(process.env["ELECTRON_RENDERER_URL"]);

function localDevServer(url: string | undefined): string | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const { protocol, hostname } = new URL(url);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return protocol === "http:" && local ? url : undefined;
}

/** The one page the app shows. The guards in security.ts refuse to navigate anywhere else. */
export const appPageUrl = devServerUrl ?? pathToFileURL(indexHtml).href;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (devServerUrl === undefined) {
    void window.loadFile(indexHtml);
  } else {
    void window.loadURL(devServerUrl);
  }

  return window;
}
