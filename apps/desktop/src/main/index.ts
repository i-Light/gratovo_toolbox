import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { BrowserWindow, Menu, app, dialog, session, shell } from "electron";

import { createAccount } from "./account/account";
import { builtPageUrl } from "./app-page";
import { registerAppScheme, serveAppFiles } from "./app-protocol";
import { createEventSender } from "./events";
import { isGoogleConsentUrl } from "./external-links";
import { createCatalog } from "./find/catalog";
import { catalogChannels, createEmailFinder } from "./find/email-finder";
import { createIdeas } from "./find/ideas";
import { createImageNetwork, createImageService } from "./find/images";
import { createFindService, searchRouting } from "./find/find-service";
import { createHandlers } from "./handlers";
import {
  createGeminiControl,
  findExtensionDir,
  geminiLaunchOptions,
} from "./gemini/gemini-control";
import { createImporter, storeOutcomeOf } from "./import/import-service";
import { registerBridge } from "./ipc-bridge";
import { createMailConsent, type MailClient } from "./mail/consent";
import { createNetwork } from "./net/network";
import { createGeminiService } from "./pipeline/gemini-service";
import { runJob } from "./pipeline/jobs";
import { openPipelineLog } from "./pipeline/logs";
import { startSchema } from "./pipeline/protocol";
import { findPython, pipelineEnv } from "./pipeline/python-path";
import { createPipelineSupervisor } from "./pipeline/supervisor";
import type { SecretStore } from "./secret-store";
import { openSecretStore } from "./secrets";
import {
  blockForeignRequests,
  denyAllPermissions,
  guardWebContents,
  refuseDownloads,
} from "./security";
import { strings } from "./strings";
import {
  createConnectionsService,
  maxMailboxes,
  startSettings,
} from "./settings/connections-service";
import { createSourceWatch, withSourceChecks } from "./settings/source-switch";
import { createWritingRulesService, playbookRulesDir } from "./settings/writing-rules";
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

const mailClientShape = startSchema.shape.secrets.shape.mail.unwrap().shape.client;

/** The stored Gmail app (`mail.client`: `{id, secret}`); null when missing or not that shape. */
async function readMailClient(secrets: SecretStore): Promise<MailClient | null> {
  try {
    const raw = await secrets.get("mail.client");
    if (raw === undefined) {
      return null;
    }
    const parsed = mailClientShape.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A file or folder dialog on the main window; null when cancelled. */
function pickPath(options: Electron.OpenDialogOptions): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const shown =
    window === undefined ? dialog.showOpenDialog(options) : dialog.showOpenDialog(window, options);
  return shown.then((result) => {
    const [path] = result.filePaths;
    return result.canceled || path === undefined ? null : path;
  });
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

  // Set once the Gemini control exists: every switch of data source stops the bridge (plan D12).
  let onSourceChanged: () => void = () => undefined;

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
      const config = supabaseConfig();
      const secrets = openSecretStore();
      const emit = createEventSender({
        targets: () => BrowserWindow.getAllWindows(),
        pageUrl: appPageUrl,
        log: (line) => {
          console.error(line);
        },
      });
      // Set once the catalog exists (it needs the account and the find service, made after this).
      let invalidateCatalog: () => void = () => undefined;
      const opened = createAccount({
        config,
        userData: app.getPath("userData"),
        secrets,
        // Every request the main process sends goes through this, to the project's host only.
        network: createNetwork({ allowedOrigins: config === null ? [] : [config.origin] }),
        now: Date.now,
        reloadWindow: () => {
          reloadWindows();
          sourceWatch.check();
        },
        // Main-to-page events go to the app's own page only, after a check of each payload. A
        // pull that changed creators or the log also makes the Find catalog rebuild.
        emit: (event, payload) => {
          emit(event, payload);
          if (
            event === "frame:changed" &&
            (payload as { parts: readonly string[] }).parts.some(
              (part) => part === "creators" || part === "log",
            )
          ) {
            invalidateCatalog();
          }
        },
      });
      // The account has no "source changed" callback: the watch checks after each call that can
      // open or close a source (sign-in, recheck, sign-out) and before each reload. Every user of
      // the account goes through `account`, so none of those calls skips the check.
      const sourceWatch = createSourceWatch(
        () => opened.source(),
        () => {
          onSourceChanged();
        },
      );
      const account = withSourceChecks(opened, sourceWatch.check);
      const userData = app.getPath("userData");
      // Two lanes (plan D14, `laneFor`): the store lane runs the jobs that write `pipeline.db`,
      // the quick lane mail, video stats and gateways, so a Send never waits behind a search.
      const pipelineLane = (kind: "pipeline" | "quick") =>
        createPipelineSupervisor({
          spawn: (command, args, options) =>
            spawn(command, [...args], { ...options, stdio: "pipe", windowsHide: true }),
          python: () =>
            findPython({ packaged: app.isPackaged, appPath: app.getAppPath(), exists: existsSync }),
          env: pipelineEnv(process.env),
          openLog: (logSecrets) =>
            openPipelineLog({
              folder: join(userData, "logs"),
              now: Date.now,
              secrets: logSecrets,
              kind,
            }),
        });
      const supervisor = pipelineLane("pipeline");
      // Nothing runs on it yet: mail (steps 6 to 9), video stats and the gateways card will.
      const quickLane = pipelineLane("quick");
      // The Gemini bridge (step 3e-3). Only the owner starts it, from Settings › Connections (ADR
      // 0016 D7); keyword ideas (step 5c) ask it when it is listening, drafts (step 6) will. It is
      // created here so quitting always stops it.
      const gemini = createGeminiService({
        spawn: (command, args, options) =>
          spawn(command, [...args], { ...options, stdio: "pipe", windowsHide: true }),
        python: () =>
          findPython({ packaged: app.isPackaged, appPath: app.getAppPath(), exists: existsSync }),
        env: pipelineEnv(process.env),
        // The per-start bridge token is blanked out of every line.
        openLog: (logSecrets) =>
          openPipelineLog({
            folder: join(userData, "logs"),
            now: Date.now,
            secrets: logSecrets,
            kind: "gemini",
          }),
      });
      const python = () =>
        findPython({ packaged: app.isPackaged, appPath: app.getAppPath(), exists: existsSync });
      /** The pipeline folder of the open data source; null when none is open. */
      const pipelineFolder = (): string | null => {
        const context = account.findContext();
        return context === null
          ? null
          : join(userData, context.mode === "example" ? "example-pipeline" : "pipeline");
      };
      const geminiControl = createGeminiControl({
        service: gemini,
        startOptions: () => {
          const source = account.source();
          const dataDir = pipelineFolder();
          if (source === null || dataDir === null) {
            return null;
          }
          const course = source.readSetting("course");
          return geminiLaunchOptions({
            dataDir,
            userData,
            extensionDir: findExtensionDir({
              packaged: app.isPackaged,
              appPath: app.getAppPath(),
              exists: existsSync,
            }),
            course: typeof course === "object" && course !== null ? course : null,
          });
        },
        pythonPath: python,
        emit: (status) => {
          emit("gemini:state", status);
        },
      });
      onSourceChanged = () => {
        invalidateCatalog();
        geminiControl.sourceChanged().catch((error: unknown) => {
          console.error("The Gemini bridge couldn't be stopped after a data switch:", error);
        });
      };
      // Set once the email finder exists (it needs the catalog, made after the find service).
      let yieldLane: () => Promise<void> = () => Promise.resolve();
      const find = createFindService({
        supervisor,
        account,
        secrets,
        userData,
        // A search needs no mailbox: its start message carries no address.
        settings: () => startSettings(account.source(), { mail: false }),
        emit: (state) => {
          emit("find:changed", state);
        },
        now: Date.now,
        // Never-contact creators are skipped by a search (plan D7).
        creatorStates: async () => (await account.source()?.creatorStates()) ?? [],
        onPipelineChanged: () => {
          invalidateCatalog();
        },
        // A lookup of emails in the background gives way to a search (plan D30).
        yieldLane: () => yieldLane(),
      });
      // The Find read model (plan D1): pipeline.db joined with the open source's creator states.
      const catalog = createCatalog({
        pipelineDbPath: () => {
          const folder = find.folder();
          return folder === null ? null : join(folder, "pipeline.db");
        },
        source: () => account.source(),
      });
      invalidateCatalog = () => {
        catalog.invalidate();
      };
      catalog.onChange((version) => {
        emit("find:catalog", { version });
      });
      // Pictures come through main (plan D9); example data only serves what is already on disk.
      const images = createImageService({
        network: createImageNetwork(),
        cacheDir: join(userData, "image-cache"),
        enabled: () => account.findContext()?.mode === "live",
        channelPicture: (id) => catalog.channelPicture(id),
      });
      serveAppFiles(session.defaultSession, rendererRoot, { images });
      const liveJobContext = (): { dataDir: string; worker: string } | null => {
        const context = account.findContext();
        const dataDir = pipelineFolder();
        return context?.mode === "live" && dataDir !== null
          ? { dataDir, worker: context.workerId }
          : null;
      };
      // After a shortlist, live only: refetch the creators with no confirmed address (plan D30).
      // The key and the route come as a search gets them; the tray hears of it in `find:emails`.
      const emailFinder = createEmailFinder({
        supervisor,
        liveContext: liveJobContext,
        youtubeKey: () => account.teamKeys.youtubeKey(),
        routing: () => searchRouting(secrets),
        settings: () => startSettings(account.source(), { mail: false }),
        channels: catalogChannels(catalog),
        onPipelineChanged: () => {
          invalidateCatalog();
        },
        emit: (event) => {
          emit("find:emails", event);
        },
      });
      yieldLane = () => emailFinder.yieldLane();
      // Keyword ideas (plan D33): the bridge when the owner has it running, a stand-in on the
      // example data. Nothing here starts the bridge.
      const ideas = createIdeas({
        mode: () => account.findContext()?.mode ?? null,
        queue: () => find.state().queue,
        bridgeReady: async () => {
          const status = await geminiControl.status();
          return status.state === "listening" && status.addon.state === "connected";
        },
        generate: (params) => gemini.call("action.generate_keywords", params),
      });
      const importer = createImporter({
        userDataDir: userData,
        localAppData: process.env["LOCALAPPDATA"] ?? null,
        isLive: () => account.findContext()?.mode === "live" && account.source() !== null,
        pipelineDataDir: () => liveJobContext()?.dataDir ?? null,
        worker: () => account.findContext()?.workerId ?? "",
        pickFile: () =>
          pickPath({
            properties: ["openFile"],
            filters: [
              { name: "SQLite database", extensions: ["db", "sqlite"] },
              { name: "All files", extensions: ["*"] },
            ],
          }),
        seedChannelNames: (rows) => account.source()?.seedChannelNames(rows) ?? 0,
        writeSetting: (key, value) => {
          account.source()?.writeSetting(key, value);
        },
        runStoreJob: async (start, onProgress) =>
          storeOutcomeOf(
            await runJob(supervisor, start, {
              onMessage: (message) => {
                if (message.type === "progress") {
                  onProgress(message);
                }
              },
            }),
          ),
        emitProgress: (event) => {
          emit("import:progress", event);
        },
        now: () => new Date(),
      });
      const connections = createConnectionsService({
        secrets,
        source: () => account.source(),
        gemini: geminiControl,
        pythonPath: () => python()?.python ?? null,
        youtubeKeyAvailable: async () => {
          if (account.status().state !== "signed-in") {
            return false;
          }
          try {
            return (await account.teamKeys.youtubeKey()) !== null;
          } catch {
            return false;
          }
        },
        syncState: () => account.syncStatus().state,
        jobContext: liveJobContext,
        runQuickJob: (start) => runJob(quickLane, start),
        pickFolder: () => pickPath({ properties: ["openDirectory"] }),
        pathExists: (path) => Promise.resolve(existsSync(path)),
        emit: (status) => {
          emit("connections:changed", status);
        },
        now: Date.now,
      });
      const writingRules = createWritingRulesService({
        rulesDir: playbookRulesDir({
          packaged: app.isPackaged,
          appPath: app.getAppPath(),
          exists: existsSync,
        }),
      });
      const mailConsent = createMailConsent({
        readClient: () => readMailClient(secrets),
        openExternal: (url) =>
          isGoogleConsentUrl(url) ? shell.openExternal(url) : Promise.reject(new Error("Refused.")),
        // Its own instance: only Google's token endpoint, never the Supabase host.
        network: createNetwork({ allowedOrigins: ["https://oauth2.googleapis.com"] }),
        // Counted as addMailbox counts; no status build and no network before the browser opens.
        canAddMailbox: async () => (await connections.mailboxCount()) < maxMailboxes,
        saveMailbox: async (address, token) => {
          const saved = await connections.addMailbox(address, token);
          return saved.ok ? saved : { ok: false, reason: saved.reason, known: saved.known };
        },
        // Step names and reasons only; the consent code never logs a secret.
        log: (line) => {
          console.info(line);
        },
      });
      // A job in either lane or a Gemini bridge running at quit is asked to stop first (and
      // killed after 5 s); then the app quits again. The flag keeps that second quit from looping.
      let quitting = false;
      app.on("before-quit", (event) => {
        if (quitting || (!supervisor.running && !quickLane.running && gemini.state === "stopped")) {
          return;
        }
        quitting = true;
        event.preventDefault();
        // allSettled never rejects, and each shutdown already logs its own failure.
        void Promise.allSettled([
          find.shutdown().catch((error: unknown) => {
            console.error("The search couldn't be stopped at quit:", error);
          }),
          quickLane.shutdown(),
          gemini.shutdown(),
        ]).finally(() => {
          app.quit();
        });
      });
      app.on("will-quit", () => {
        geminiControl.dispose();
        emailFinder.dispose();
        catalog.close();
        account.close();
      });
      // The data opens before the page can ask for it, as the example source did. With a stored
      // session this reads the local copy and checks with the server in the background. A database
      // that won't open lands in the start-up error dialog below.
      await account.start();
      sourceWatch.prime();
      registerBridge(
        createHandlers({
          version: app.getVersion(),
          secrets,
          account,
          find,
          catalog,
          ideas,
          onCreatorsWritten: invalidateCatalog,
          onShortlisted: (ids) => {
            emailFinder.shortlisted(ids);
          },
          importer,
          connections,
          gemini: geminiControl,
          writingRules,
          mailConsent,
        }),
      );
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
