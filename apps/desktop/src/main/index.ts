import { BrowserWindow, Menu, app, dialog, session } from "electron";

import { createAccount } from "./account/account";
import { builtPageUrl } from "./app-page";
import { registerAppScheme, serveAppFiles } from "./app-protocol";
import { createEventSender } from "./events";
import { createHandlers } from "./handlers";
import { registerBridge } from "./ipc-bridge";
import { createNetwork } from "./net/network";
import { openSecretStore } from "./secrets";
import {
  blockForeignRequests,
  denyAllPermissions,
  guardWebContents,
  refuseDownloads,
} from "./security";
import { strings } from "./strings";
import { describeConfigProblem, readSupabaseConfig, type SupabaseConfig } from "./supabase/config";
import { appPageUrl, createMainWindow, rendererRoot } from "./window";

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

/** The Supabase project from the build (or, unpackaged, the test seam); null when there is none. */
function supabaseConfig(): SupabaseConfig | null {
  const result = readSupabaseConfig({
    packaged: app.isPackaged,
    built: {
      url: import.meta.env.MAIN_VITE_SUPABASE_URL,
      key: import.meta.env.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    env: process.env,
  });
  if (!result.ok) {
    // Names the problem, never a value. "missing" is the normal state of dev builds and tests.
    console.info(`${describeConfigProblem(result.problem)} The app shows the example data.`);
    return null;
  }
  return result.config;
}

/** Reloads the page after the IPC answer in progress has gone out; it starts over from auth:status. */
function reloadWindows(): void {
  setTimeout(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.reload();
    }
  }, 0);
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
    .then(async () => {
      denyAllPermissions(session.defaultSession);
      // The dev server is the page only when appPageUrl is not the built page (never when packaged).
      blockForeignRequests(
        session.defaultSession,
        appPageUrl === builtPageUrl ? undefined : appPageUrl,
      );
      refuseDownloads(session.defaultSession);
      serveAppFiles(session.defaultSession, rendererRoot);
      const config = supabaseConfig();
      const secrets = openSecretStore();
      const account = createAccount({
        config,
        userData: app.getPath("userData"),
        secrets,
        // Every request the main process sends goes through this, to the project's host only.
        network: createNetwork({ allowedOrigins: config === null ? [] : [config.origin] }),
        now: Date.now,
        reloadWindow: reloadWindows,
        // Main-to-page events go to the app's own page only, after a check of each payload.
        emit: createEventSender({
          targets: () => BrowserWindow.getAllWindows(),
          pageUrl: appPageUrl,
          log: (line) => {
            console.error(line);
          },
        }),
      });
      app.on("will-quit", () => {
        account.close();
      });
      // The data opens before the page can ask for it, as the example source did. With a stored
      // session this reads the local copy and checks with the server in the background. A database
      // that won't open lands in the start-up error dialog below.
      await account.start();
      registerBridge(createHandlers({ version: app.getVersion(), secrets, account }));
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
