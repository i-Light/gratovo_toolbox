import { BrowserWindow, Menu, app, dialog, session } from "electron";

import { registerAppScheme, serveAppFiles } from "./app-protocol";
import { createHandlers } from "./handlers";
import { registerBridge } from "./ipc-bridge";
import { openSecretStore } from "./secrets";
import { denyAllPermissions, guardWebContents, refuseDownloads } from "./security";
import { strings } from "./strings";
import { createMainWindow, rendererRoot } from "./window";

/**
 * Unpackaged runs (`pnpm dev`, the end-to-end tests) keep their data, and their single-instance
 * lock, apart from the installed app's. The tests name a fresh folder for every test.
 */
function separateDevelopmentData(): void {
  if (app.isPackaged) {
    return;
  }
  const testFolder = process.env["GRATOVO_USER_DATA"];
  const folder =
    testFolder !== undefined && testFolder !== "" ? testFolder : `${app.getPath("userData")} (dev)`;
  app.setPath("userData", folder);
}

function start(): void {
  // Every renderer runs in Chromium's sandbox, whatever a window's own settings say.
  app.enableSandbox();
  registerAppScheme();

  app.on("web-contents-created", (_event, contents) => {
    guardWebContents(contents);
  });

  // A second launch brings this copy's window forward instead.
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  app
    .whenReady()
    .then(() => {
      denyAllPermissions(session.defaultSession);
      refuseDownloads(session.defaultSession);
      serveAppFiles(session.defaultSession, rendererRoot);
      registerBridge(createHandlers({ version: app.getVersion(), secrets: openSecretStore() }));
      // The app draws its whole frame. Electron's default menu (File, Edit, View…) would sit above
      // it on Windows and bring shortcuts the app doesn't want, such as reload and zoom. Copy,
      // paste and undo in text fields work without it on Windows.
      Menu.setApplicationMenu(null);
      createMainWindow();
    })
    .catch((error: unknown) => {
      console.error("The app couldn't start:", error);
      dialog.showErrorBox(strings.startupFailed.title, strings.startupFailed.body);
      // Exit for real: a copy left running with no window would keep the single-instance lock,
      // and every later launch would only knock on its door.
      app.exit(1);
    });

  // The app targets Windows, where closing the last window ends the app.
  app.on("window-all-closed", () => {
    app.quit();
  });
}

separateDevelopmentData();

// One copy of the app at a time, so two never write the secrets file (or, later, the database)
// at once.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}
