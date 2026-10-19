import { flipFuses, FuseV1Options, FuseVersion, type FuseV1Config } from "@electron/fuses";

/** The fuses every release build ships with. 3h's packager applies them to the packaged app. */
export const releaseFuses = {
  version: FuseVersion.V1,
  // An Electron upgrade that adds a fuse fails here until someone decides its value, so a new
  // switch is never left at its default by accident.
  strictlyRequireAllFuses: true,
  // No ELECTRON_RUN_AS_NODE: it would turn the app into a plain Node that runs any script.
  [FuseV1Options.RunAsNode]: false,
  // Encrypt cookies on disk with the operating system's key store.
  [FuseV1Options.EnableCookieEncryption]: true,
  // NODE_OPTIONS must not be able to inject code or flags into the app.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // No --inspect: it would open a debugger anyone on the machine could attach to.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // Refuse an app.asar that was changed after it was built.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // Load the app only from app.asar, never from a loose folder placed next to it.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // We don't ship a custom browser-process V8 snapshot, so don't look for one.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The app serves its page from app://, not file://, so file pages get no extra privileges.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  // Electron's default; kept on so WebAssembly out-of-bounds faults are handled safely.
  [FuseV1Options.WasmTrapHandlers]: true,
} satisfies FuseV1Config;

/** Flips the release fuses in an Electron binary (electron.exe in a packaged app). */
export async function applyReleaseFuses(electronBinary: string): Promise<void> {
  await flipFuses(electronBinary, releaseFuses);
}
