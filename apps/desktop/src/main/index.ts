import { BrowserWindow, app, session } from "electron";

import { registerAppScheme, serveAppFiles } from "./app-protocol";
import { createHandlers } from "./handlers";
import { registerBridge } from "./ipc-bridge";
import { openSecretStore } from "./secrets";
import { denyAllPermissions, guardWebContents } from "./security";
import { createMainWindow, rendererRoot } from "./window";

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

  void app.whenReady().then(() => {
    denyAllPermissions(session.defaultSession);
    serveAppFiles(session.defaultSession, rendererRoot);
    registerBridge(createHandlers({ version: app.getVersion(), secrets: openSecretStore() }));
    createMainWindow();
  });

  // The app targets Windows, where closing the last window ends the app.
  app.on("window-all-closed", () => {
    app.quit();
  });
}

// One copy of the app at a time, so two never write the secrets file (or, later, the database)
// at once.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}
