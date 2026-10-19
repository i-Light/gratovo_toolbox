import { join } from "node:path";

import { BrowserWindow, app } from "electron";

import { builtPageUrl, localDevServer } from "./app-page";

/** The built renderer's folder. app-protocol.ts serves it as app://gratovo/. */
export const rendererRoot = join(__dirname, "../renderer");

const preloadScript = join(__dirname, "../preload/index.js");

// A packaged app ignores the dev server variable altogether.
const devServerUrl = app.isPackaged
  ? undefined
  : localDevServer(process.env["ELECTRON_RENDERER_URL"]);

/** The one page the app shows. The guards in security.ts refuse to navigate anywhere else. */
export const appPageUrl = devServerUrl ?? builtPageUrl;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: preloadScript,
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

  // With no menu there is no shortcut for the developer tools, so unpackaged runs open them with F12.
  if (!app.isPackaged) {
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        event.preventDefault();
        window.webContents.toggleDevTools();
      }
    });
  }

  void window.loadURL(appPageUrl);

  return window;
}
