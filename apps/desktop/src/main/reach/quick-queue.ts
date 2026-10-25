import type { JobOutcome } from "../pipeline/jobs";
import type { Start } from "../pipeline/protocol";

/**
 * Reach's queue in front of the quick lane (plan step 6, D11). Jobs run one at a time, in the
 * order they came. The lane runs one job at a time for everyone, so when it is busy with someone
 * else's job (Settings' "Check mailboxes", say) the start is refused as `running`: the queue waits
 * `retryMs` and tries again, for as long as it takes. It never drops a job, so a person's Send is
 * never lost to a busy lane. Any other outcome (`no_python` included) is the job's answer.
 */
export interface QuickQueue {
  /** Runs `start` after every job queued before it; resolves with how it went. */
  enqueue(start: Start): Promise<JobOutcome>;
  /** Resolves once every job queued so far has finished. */
  idle(): Promise<void>;
}

export interface QuickQueueDeps {
  /** Runs one job on the quick lane (main's `runJob(quickLane, start)`). */
  run(start: Start): Promise<JobOutcome>;
  /** How long to wait before trying a busy lane again. */
  retryMs?: number;
  /** Waits `ms`; a timer unless a test names another. */
  wait?: (ms: number) => Promise<void>;
}

export const quickRetryMs = 2000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createQuickQueue(deps: QuickQueueDeps): QuickQueue {
  const retryMs = deps.retryMs ?? quickRetryMs;
  const wait = deps.wait ?? sleep;
  // The end of the last job queued. It never rejects, so one failed job can't stop the rest.
  let tail: Promise<void> = Promise.resolve();

  async function runToEnd(start: Start): Promise<JobOutcome> {
    for (;;) {
      const outcome = await deps.run(start);
      if (outcome.ok || outcome.problem !== "running") {
        return outcome;
      }
      await wait(retryMs);
    }
  }

  return {
    enqueue(start) {
      const outcome = tail.then(() => runToEnd(start));
      tail = outcome.then(
        () => undefined,
        () => undefined,
      );
      return outcome;
    },
    idle: () => tail,
  };
}
