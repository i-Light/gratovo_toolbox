import type { ConnectionsStatus, GeminiStatus, PrototypeStatus } from "@gratovo/ipc";

import type { Prototype } from "./prototype";
import type { HandlerServices } from "./services";

/**
 * Stand-ins for the step 4 services until each is built (plan step 4, task W1 replaces them).
 * They touch nothing: no file, no secret, no dialog, no network, no child process. Each answers
 * the safe "not built yet" value its channel allows, so the page can be built against the real
 * contract in the meantime.
 */

const notBuilt = { ok: false, reason: "not_built" } as const;

function stoppedGemini(): GeminiStatus {
  return {
    state: "stopped",
    addon: { state: "missing", version: null },
    browser: null,
    problem: "not_built",
  };
}

/** What Connections shows before anything is set: nothing found, nothing connected. */
export function emptyConnectionsStatus(): ConnectionsStatus {
  return {
    python: { state: "missing" },
    youtube: { state: "unavailable" },
    gemini: stoppedGemini(),
    mailApp: { set: false },
    mailboxes: [],
    mail: { label: "Gratovo Outreach", senderName: null },
    proxies: { count: 0, enabled: false, includeDirect: true },
    pacing: "normal",
    parallel: { enabled: false, maxWorkers: 4 },
    aws: { keys: false, enabled: false, regions: [] },
    course: { courseDir: null, videoDir: null, courseFound: false },
    sync: { state: "off" },
    import: { state: "never", at: null, backup: null },
  };
}

/** Prototype mode that is off and can't be turned on: no copy, and every comment call throws. */
export function stubPrototype(): Prototype {
  const off: PrototypeStatus = { available: false, on: false, scenario: "normal" };
  const refuse = (): never => {
    throw new Error("prototype mode is off");
  };
  return {
    status: () => Promise.resolve(off),
    set: () => Promise.reject(new Error("prototype mode is for the owner")),
    setScenario: () => Promise.reject(new Error("prototype mode is off")),
    isOn: () => false,
    source: () => null,
    comments: {
      list: refuse,
      add: refuse,
      update: refuse,
      remove: refuse,
      restore: refuse,
      exportTo: refuse,
    },
    close: () => undefined,
  };
}

export function createStubServices(): HandlerServices {
  return {
    importer: {
      candidates: () => Promise.resolve({ candidates: [] }),
      pick: () => Promise.resolve({ path: null }),
      dryRun: () => Promise.resolve(notBuilt),
      run: () => Promise.resolve(notBuilt),
    },
    connections: {
      status: () => Promise.resolve(emptyConnectionsStatus()),
      set: () => Promise.resolve(notBuilt),
      pickFolder: () => Promise.resolve({ path: null }),
      checkMailboxes: () => Promise.resolve(notBuilt),
      deployGateways: () => Promise.resolve(notBuilt),
      removeGateways: () => Promise.resolve(notBuilt),
    },
    gemini: {
      status: stoppedGemini,
      start: () => Promise.resolve(stoppedGemini()),
      stop: () => Promise.resolve(stoppedGemini()),
      openWindow: () => Promise.resolve(stoppedGemini()),
    },
    writingRules: {
      list: () => Promise.resolve({ found: false, rules: [] }),
    },
    mailConsent: {
      connect: () => Promise.resolve(notBuilt),
    },
    reach: {
      thread: () => Promise.resolve({ ok: false, problem: "no_data" }),
      draftNow: () => Promise.resolve({ ok: false, problem: "no_data" }),
      rewrite: () => Promise.resolve({ ok: false, problem: "not_found" }),
      retry: () => Promise.resolve({ ok: false, problem: "not_found" }),
      markSent: () => Promise.resolve({ ok: false, problem: "not_found" }),
      sendNew: () => Promise.resolve({ ok: false, problem: "not_found" }),
      refreshMailboxes: () => Promise.resolve({ ok: false, problem: "no_data" }),
      setMailbox: () => Promise.resolve({ ok: false, problem: "no_data" }),
      sendTest: () => Promise.resolve({ ok: false, problem: "no_data" }),
      sequenceStop: () => Promise.resolve({ ok: false, problem: "no_data" }),
      sequenceResume: () => Promise.resolve({ ok: false, problem: "no_data" }),
      park: () => Promise.resolve({ ok: false, problem: "no_data" }),
      wake: () => Promise.resolve({ ok: false, problem: "no_data" }),
      checkReplies: () => Promise.resolve({ ok: false, problem: "no_data" }),
      pasteReply: () => Promise.resolve({ ok: false, problem: "no_data" }),
      reclassify: () => Promise.resolve({ ok: false, problem: "no_data" }),
      situations: () => Promise.resolve({ ok: false, problem: "no_data" }),
      overlay: (frame) => Promise.resolve(frame),
      afterWrite: () => undefined,
    },
    prototype: stubPrototype(),
  };
}
