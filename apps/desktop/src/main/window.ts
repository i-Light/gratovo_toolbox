import { join } from "node:path";

import { BrowserWindow, app, screen } from "electron";

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

/**
 * A test run: unpackaged, with its own data folder (the Electron tests and the lead's screenshot
 * scripts set GRATOVO_USER_DATA). `pnpm dev` and the installed app never are.
 */
const testRun = !app.isPackaged && (process.env["GRATOVO_USER_DATA"] ?? "") !== "";

/**
 * A test run opens at the top-left corner of the second screen, out of the way of whoever is
 * working on the main one (owner, 2026-10-25). With one screen, Windows places it as usual.
 */
function testPlace(): { x: number; y: number } | Record<string, never> {
  if (!testRun) return {};
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((display) => display.id !== primary.id);
  return other === undefined ? {} : { x: other.workArea.x, y: other.workArea.y };
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...testPlace(),
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: false,
    // The dark --bg, so nothing light shows before the page paints (the app is dark only for now).
    backgroundColor: "#06131d",
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
    // A test run doesn't take the keyboard from the person working; the tests drive the page
    // directly, without the system's focus.
    if (testRun) {
      window.showInactive();
    } else {
      window.show();
    }
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
