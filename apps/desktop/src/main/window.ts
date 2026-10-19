import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow, app } from "electron";

const indexHtml = join(__dirname, "../renderer/index.html");

/**
 * electron-vite sets this in development. A packaged app ignores it, so a stray environment
 * variable can never point the app at another page.
 */
const devServerUrl = app.isPackaged ? undefined : process.env["ELECTRON_RENDERER_URL"];

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
