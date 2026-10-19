import { app, session } from "electron";

import { denyAllPermissions, guardWebContents } from "./security";
import { createMainWindow } from "./window";

// Every renderer runs in Chromium's sandbox, whatever a window's own settings say.
app.enableSandbox();

app.on("web-contents-created", (_event, contents) => {
  guardWebContents(contents);
});

void app.whenReady().then(() => {
  denyAllPermissions(session.defaultSession);
  createMainWindow();
});

// The app targets Windows, where closing the last window ends the app.
app.on("window-all-closed", () => {
  app.quit();
});
