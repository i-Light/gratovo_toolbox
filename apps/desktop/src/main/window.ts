import { BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Set by electron-vite in development. In a built app the page is loaded from its own files.
const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
const rendererDir = join(__dirname, "../renderer");

/** The app's own pages only: the dev server's origin in development, its files when built. */
function isAppUrl(url: string): boolean {
  if (devServerUrl) {
    return new URL(url).origin === new URL(devServerUrl).origin;
  }
  return url.startsWith(pathToFileURL(rendererDir).href + "/");
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    title: "Gratovo",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  // No new windows, and no navigation away from the app. Links to the web are opened in the browser
  // through an allowlist in step 3b.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });

  // Deny every permission (camera, location, notifications and the rest) by default.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(rendererDir, "index.html"));
  }

  return window;
}
