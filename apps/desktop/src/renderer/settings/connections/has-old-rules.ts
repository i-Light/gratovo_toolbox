import type { ImportReport } from "@gratovo/ipc";

/** Whether the old app's search settings were found, so "Use my old search rules" makes sense. */
export function hasOldRules(report: ImportReport): boolean {
  return report.settingsFiles.some(
    (file) => file.found && (file.name === "run_config.json" || file.name === "settings.json"),
  );
}
