import type { ConnectionsStatus, MailCheckResult } from "@gratovo/ipc";

import { pipelineSecretNames } from "../pipeline/pipeline-secrets";

import { buildQuickStart } from "./connections-jobs";
import type { AddMailboxResult, ConnectionsDeps } from "./connections-service";
import type { HealthOf } from "./connections-status";
import {
  mailSecretShape,
  maxMailboxes,
  readMailRows,
  readTokens,
  sameAddress,
  type MailboxRow,
} from "./connections-store";

/**
 * The Gmail mailboxes (plan D10, D11): adding a consented one, counting them, and "Check
 * mailboxes" (`mail.status`), whose answers are kept in memory only.
 */

const defaultCap = 20;

type Health = "ok" | "signed-out" | "error";

export interface Mailboxes {
  healthOf: HealthOf;
  /** Forgets a removed mailbox's last check. */
  forget: (address: string) => void;
  check: () => Promise<MailCheckResult>;
  add: (address: string, refreshToken: string) => Promise<AddMailboxResult>;
  count: () => Promise<number>;
}

/** Every connected address, lower case: the settings rows and the stored tokens together. */
function addressesOf(
  tokens: readonly { address: string }[],
  rows: readonly MailboxRow[],
): Set<string> {
  return new Set([
    ...tokens.map((t) => t.address.trim().toLowerCase()),
    ...rows.map((m) => m.address.trim().toLowerCase()),
  ]);
}

export function createMailboxes(
  deps: Pick<
    ConnectionsDeps,
    "secrets" | "source" | "pythonPath" | "jobContext" | "runQuickJob" | "now"
  >,
  /** Builds the status, sends it to the page and answers it. */
  publish: () => Promise<ConnectionsStatus>,
): Mailboxes {
  const { secrets } = deps;
  const now = deps.now ?? Date.now;
  // The last `mail.status` answer per address (lower case).
  const health = new Map<string, { health: Health; checkedAt: string }>();

  async function check(): Promise<MailCheckResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    if (deps.pythonPath() === null) {
      return { ok: false, reason: "no_python" };
    }
    if (!(await secrets.has(pipelineSecretNames.mailClient))) {
      return { ok: false, reason: "no_client" };
    }
    if (readMailRows(source).mailboxes.length === 0) {
      return { ok: false, reason: "no_mailboxes" };
    }
    const start = await buildQuickStart(deps, source, { kind: "mail.status" }, { mail: true });
    if (start === null) {
      return { ok: false, reason: "no_data" };
    }
    const outcome = await deps.runQuickJob(start);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.problem === "no_python" ? "no_python" : "failed" };
    }
    const exit = outcome.exit;
    if (exit.kind !== "ended" || exit.end.state !== "done" || exit.result?.kind !== "mail.status") {
      return { ok: false, reason: "failed" };
    }
    const at = new Date(now()).toISOString();
    for (const account of exit.result.data.accounts) {
      if (account.account === null) {
        continue;
      }
      let state: Health = "ok";
      if (account.error !== null) {
        state = account.error.code === "mail_auth" ? "signed-out" : "error";
      } else if (!account.connected) {
        state = "signed-out";
      }
      health.set(account.account.trim().toLowerCase(), { health: state, checkedAt: at });
    }
    const fresh = await publish();
    return { ok: true, mailboxes: fresh.mailboxes };
  }

  /** Whether a token for this address is stored. Unreadable counts as stored (see `known`). */
  async function tokenStored(address: string): Promise<boolean> {
    try {
      return (await readTokens(secrets)).some((t) => sameAddress(t.address, address));
    } catch {
      return true;
    }
  }

  /**
   * Stores the token, then the settings row. All or nothing: if the row can't be written, the
   * token secret is put back as it was, so a failed add leaves no dead token taking a place.
   */
  async function add(address: string, refreshToken: string): Promise<AddMailboxResult> {
    const wanted = address.trim().toLowerCase();
    const known = await tokenStored(wanted);
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data", known };
    }
    const entry = mailSecretShape.mailboxes.element.safeParse({ address: wanted, refreshToken });
    if (!entry.success) {
      return { ok: false, reason: "failed", known };
    }
    let previous: string | undefined;
    let tokenWritten = false;
    try {
      previous = await secrets.get(pipelineSecretNames.mailboxes);
      const tokens = await readTokens(secrets);
      const mail = readMailRows(source);
      const all = addressesOf(tokens, mail.mailboxes);
      if (!all.has(entry.data.address) && all.size >= maxMailboxes) {
        return { ok: false, reason: "too_many", known };
      }
      await secrets.set(
        pipelineSecretNames.mailboxes,
        JSON.stringify([
          ...tokens.filter((t) => !sameAddress(t.address, entry.data.address)),
          entry.data,
        ]),
      );
      tokenWritten = true;
      if (!mail.mailboxes.some((m) => sameAddress(m.address, entry.data.address))) {
        source.writeSetting("mail.settings", {
          ...mail,
          mailboxes: [
            ...mail.mailboxes,
            {
              address: entry.data.address,
              dailyCap: defaultCap,
              warmupStartedOn: new Date(now()).toISOString().slice(0, 10),
            },
          ],
        });
      }
    } catch {
      console.error("Connections: the mailbox couldn't be saved.");
      if (!tokenWritten) {
        return { ok: false, reason: "failed", known };
      }
      try {
        if (previous === undefined) {
          await secrets.delete(pipelineSecretNames.mailboxes);
        } else {
          await secrets.set(pipelineSecretNames.mailboxes, previous);
        }
      } catch {
        // The new token stays stored and working: it must not be revoked.
        console.error("Connections: the mailbox token couldn't be taken back out.");
        return { ok: false, reason: "failed", known: true };
      }
      return { ok: false, reason: "failed", known };
    }
    // Saved: a failure to tell the page must not read as a failed save (the consent would revoke
    // a token that is stored).
    try {
      await publish();
    } catch {
      console.error("Connections: the status couldn't be sent after adding a mailbox.");
    }
    return { ok: true };
  }

  return {
    healthOf: (address) => health.get(address.trim().toLowerCase()),
    forget(address) {
      health.delete(address.trim().toLowerCase());
    },
    check,
    add,
    // The same count `add` enforces: no status build, no job, no network.
    async count() {
      return addressesOf(await readTokens(secrets), readMailRows(deps.source()).mailboxes).size;
    },
  };
}
