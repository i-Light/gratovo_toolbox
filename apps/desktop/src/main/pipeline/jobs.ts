import type { JobKind, PipelineMessage, ReplyMessage, Start } from "./protocol";
import type { PipelineExit, PipelineSupervisor } from "./supervisor";

/**
 * Main runs the pipeline's jobs in two lanes, each its own supervisor (plan D14). The store lane
 * (step 4's plan calls it the main lane) runs the jobs that write `pipeline.db`, the import
 * included, never two at once; the quick lane runs the rest one at a time, so `mailbox.db` has one
 * writer and a Send never waits hours behind a search.
 */

export type Lane = "store" | "quick";

export function laneFor(kind: JobKind): Lane {
  switch (kind) {
    case "search":
    case "refetch":
    case "backfill":
    case "import.legacy":
    case "archive.sweep":
    case "archive.restore":
    case "example.load":
      return "store";
    case "mail.status":
    case "mail.send":
    case "mail.replies":
    case "mail.ack":
    case "mail.cancel":
    case "mail.import":
    case "video_stats":
    case "gateways.deploy":
    case "gateways.destroy":
    case "gateways.test":
      return "quick";
  }
}

export type JobOutcome =
  | { ok: true; exit: PipelineExit; replies: ReplyMessage[] }
  | { ok: false; problem: "running" | "no_python" };

/**
 * Runs one job to its end: resolves with how it exited (its result is in `exit`) and every reply
 * it sent, or at once when it couldn't start. `onMessage` sees each message as it arrives.
 */
export function runJob(
  supervisor: Pick<PipelineSupervisor, "start">,
  start: Start,
  o: { onMessage?: (message: PipelineMessage) => void } = {},
): Promise<JobOutcome> {
  return new Promise((resolve) => {
    const replies: ReplyMessage[] = [];
    const started = supervisor.start(start, {
      onMessage(message) {
        if (message.type === "reply") {
          replies.push(message);
        }
        o.onMessage?.(message);
      },
      onExit(exit) {
        resolve({ ok: true, exit, replies });
      },
    });
    if (!started.ok) {
      resolve(started);
    }
  });
}
