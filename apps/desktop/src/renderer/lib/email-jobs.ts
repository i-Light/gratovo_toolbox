import type { Bridge } from "@gratovo/ipc/bridge";

import { appStore, type Job } from "./store";

/** The email lookup is one job at a time, so it keeps one row in the tray. */
const jobId = "find-emails";

/** How long a finished lookup stays in the tray. */
export const emailJobStaysMs = 8000;

/**
 * Shows main's email lookup (`find:emails`) in the jobs tray: a running row while it looks, then a
 * finished row ("3 emails found", or why it failed) that clears itself after a few seconds.
 * Returns a function that stops listening.
 */
export function installEmailJobs(bridge: Pick<Bridge, "on">): () => void {
  let clear: ReturnType<typeof setTimeout> | null = null;
  const put = (job: Job): void => {
    appStore().ui((ui) => {
      ui.jobs = [...ui.jobs.filter((j) => j.id !== jobId), job];
    });
  };
  const off = bridge.on("find:emails", (event) => {
    if (clear !== null) {
      clearTimeout(clear);
      clear = null;
    }
    const finished = event.state !== "running";
    put({
      id: jobId,
      kind: "contacts",
      label: event.label,
      progress: 0,
      total: event.channels,
      done: finished,
      ...(finished && event.detail !== null ? { note: event.detail } : {}),
    });
    if (finished) {
      clear = setTimeout(() => {
        clear = null;
        appStore().ui((ui) => {
          ui.jobs = ui.jobs.filter((j) => j.id !== jobId);
        });
      }, emailJobStaysMs);
    }
  });
  return () => {
    off();
    if (clear !== null) {
      clearTimeout(clear);
    }
  };
}
