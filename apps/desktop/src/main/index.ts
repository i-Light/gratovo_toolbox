import { app } from "electron";

import { createMainWindow } from "./window";

// One window, and the app quits with it. Single-instance locking and the update checks come later.
app.on("window-all-closed", () => {
  app.quit();
});

void app.whenReady().then(() => {
  createMainWindow();
});
