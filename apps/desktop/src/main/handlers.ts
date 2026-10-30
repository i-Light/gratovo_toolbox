import { join } from "node:path";

import type { CreatorStage, DataSource, DataWrite } from "@gratovo/core/data";
import type { Channel, Handlers } from "@gratovo/ipc";

import type { Account } from "./account/account";
import type { ArchiveService } from "./find/archive-service";
import type { FindCatalog } from "./find/catalog-types";
import type { FindIdeas } from "./find/ideas";
import type { FindService } from "./find/find-service";
import { readViews, writeViews } from "./find/saved-views";
import {
  countArchived,
  readArchived,
  toolboxCounts,
  toolboxList,
  type ArchivedNames,
} from "./find/toolbox";
import type { InsightsService } from "./insights/service";
import { prototypeRefused, refusedWhileOn } from "./prototype/refused";
import type { SecretStore } from "./secret-store";
import type { HandlerServices } from "./services";

/**
 * What the handlers need from the rest of the main process. The step 4 services (`importer`,
 * `connections`, `gemini`, `writingRules`, `mailConsent`) and `prototype` are typed in
 * `services.ts`; their handlers only delegate.
 */
export interface HandlerContext extends HandlerServices {
  version: string;
  /**
   * The repository's root while the app runs from it, for the comments' export (D8). Null or left
   * out: there is none, and the export answers `no_repo`.
   */
  repoRoot?: string | null;
  secrets: SecretStore;
  find: FindService;
  /** The Find catalog: pages, one channel's detail and the run history. */
  catalog: FindCatalog;
  /** Gemini's keyword ideas for the queue (plan step 5, D33). */
  ideas: FindIdeas;
  /**
   * Called after a stored `data:write` batch that changes what the catalog shows: a creator's
   * stage or contact, a log line about a creator, or a settled conflict (plan D1). The catalog rebuilds on
   * it.
   */
  onCreatorsWritten?: () => void;
  /**
   * Called after a stored `data:write` batch with the creators it moved to shortlisted, so the
   * email finder can look for their addresses (plan step 5c, D30).
   */
  onShortlisted?: (ids: readonly string[]) => void;
  /**
   * The archive service (plan step 5d, D37 and D38): the sweep and Bring back from "Archived for
   * good". Without it a restore answers `no_python`, as no job can run.
   */
  archive?: Pick<ArchiveService, "sweep" | "restore">;
  /**
   * The Insights service (plan step P8a): the reports, the records behind a number, hidden alerts
   * and the goal. Without it the four `insights:*` channels refuse.
   */
  insights?: InsightsService;
  account: Pick<
    Account,
    | "status"
    | "source"
    | "signIn"
    | "recheck"
    | "signOut"
    | "syncStatus"
    | "syncNow"
    | "setPresence"
  >;
}

/**
 * Whether one write can change a catalog row: a stage, a contact, a log line on a creator (add)
 * or any removal, or a conflict settled (keeping yours puts your value back). Notes aren't in the rows:
 * the detail reads them fresh, and the notes box knows what it saved.
 */
function changesCatalog(write: DataWrite): boolean {
  return (
    write.kind === "creator.stage" ||
    write.kind === "creator.contact" ||
    write.kind === "conflict.resolve" ||
    (write.kind === "log.add" && write.ref !== null) ||
    write.kind === "log.remove"
  );
}

/** One channel's handler, made to throw while prototype mode is on (plan D6). */
function guarded<C extends Channel>(
  handlers: Handlers,
  channel: C,
  isOn: () => boolean,
): Handlers[C] {
  const real: Handlers[C] = handlers[channel];
  const guard = (input: Parameters<Handlers[C]>[0]) => {
    if (isOn()) {
      throw new Error(prototypeRefused);
    }
    return real(input);
  };
  return guard as Handlers[C];
}

/** The same handlers, with every channel in `refusedWhileOn` refused while prototype mode is on. */
function refuseWhileOn(handlers: Handlers, isOn: () => boolean): Handlers {
  const out: Handlers = { ...handlers };
  for (const channel of refusedWhileOn) {
    Object.assign(out, { [channel]: guarded(handlers, channel, isOn) });
  }
  return out;
}

/** The main process's answer to each channel in `channels`. */
export function createHandlers(context: HandlerContext): Handlers {
  return refuseWhileOn(buildHandlers(context), () => context.prototype.isOn());
}

function buildHandlers(context: HandlerContext): Handlers {
  const { version, secrets, account, find, catalog, ideas } = context;
  const { importer, connections, gemini, writingRules, mailConsent, reach, prototype } = context;

  /** The account's open source. The page never asks for data while none is open. */
  function openSource(): DataSource {
    const source = account.source();
    if (source === null) {
      throw new Error("No data is open: the account is signed out or waiting for access.");
    }
    return source;
  }

  /** The Insights service; a call without one is refused. */
  function insightsService(): InsightsService {
    if (context.insights === undefined) {
      throw new Error("Insights is not available yet.");
    }
    return context.insights;
  }

  /** `pipeline.db` in the open data folder; null with none. */
  function pipelineDb(): string | null {
    const folder = find.folder();
    return folder === null ? null : join(folder, "pipeline.db");
  }

  /**
   * The app's name and stage for each creator, for the archived search and rows, from the catalog's
   * rows: the page asks on every keystroke, page and tick, too often to read every creator's state.
   * A name that is only the handle or the id (the rows' fallback) is no name.
   */
  async function archivedNames(): Promise<ArchivedNames> {
    const { rows } = await catalog.snapshot();
    return new Map(
      rows.map((row) => [
        row.id,
        {
          name: row.name === row.id || row.name === row.handle ? null : row.name,
          stage: row.stage,
        },
      ]),
    );
  }

  return {
    "app:ping": () => ({ ok: true, version }),
    "secrets:status": async ({ name }) => ({ set: await secrets.has(name) }),
    "frame:load": async () => reach.overlay(await openSource().frame()),
    // A rejection goes up to the dispatcher, which logs it; the page learns only that it failed.
    "data:write": async ({ writes }) => {
      const source = openSource();
      const toShortlist = writes.flatMap((write) =>
        write.kind === "creator.stage" && write.stage === "shortlisted" ? [write.id] : [],
      );
      // Only a creator coming from new or rejected (or with no row yet) needs its addresses looked
      // up. Undoing a Confirm moves contact back to shortlisted, and must not spend quota (D30).
      const before =
        toShortlist.length === 0 || context.onShortlisted === undefined
          ? new Map<string, CreatorStage>()
          : new Map((await source.creatorStates()).map((c) => [c.id, c.stage]));
      await source.write(writes);
      reach.afterWrite(writes);
      if (writes.some(changesCatalog)) {
        context.onCreatorsWritten?.();
      }
      const shortlisted = toShortlist.filter((id) => {
        const stage = before.get(id);
        return stage === undefined || stage === "new" || stage === "rejected";
      });
      if (shortlisted.length > 0) {
        context.onShortlisted?.(shortlisted);
      }
      return {};
    },
    "auth:status": () => account.status(),
    // The password goes to the account once and is neither kept nor logged here.
    "auth:sign-in": ({ email, password }) => account.signIn(email, password),
    "auth:recheck": () => account.recheck(),
    "auth:sign-out": async () => {
      // A running search ends first: its data folder is the signed-in account's.
      await find.shutdown();
      await account.signOut();
      return {};
    },
    // Counts and a state only: no row data, no token.
    "sync:status": () => account.syncStatus(),
    "sync:now": () => account.syncNow(),
    // A screen name and a flag only (D26); the account ignores it unless signed in.
    "presence:set": ({ screen, idle }) => {
      account.setPresence({ screen, idle });
      return {};
    },
    "find:state": () => find.state(),
    "find:add": ({ keywords }) => find.add(keywords),
    "find:remove": ({ index }) => find.remove(index),
    "find:start-at": ({ index }) => find.startAt(index),
    "find:start": () => find.start(),
    "find:stop": () => {
      find.stop();
      return {};
    },
    "find:query": (request) => catalog.query(request),
    "find:item": ({ id }) => catalog.item(id),
    "find:runs": () => catalog.runs(),
    "find:views": () => ({ views: readViews(openSource()) }),
    "find:views-set": ({ views }) => writeViews(openSource(), views),
    "find:ideas": ({ count }) => ideas.suggest(count),
    "log:for": async ({ ref, limit }) => ({ lines: [...(await openSource().logFor(ref, limit))] }),
    "log:page": async (request) => {
      const page = await openSource().logPage(request);
      return {
        lines: [...page.lines],
        more: page.more,
        people: [...page.people],
        total: page.total,
      };
    },
    // Plan step 5d: the Toolbox (D34 to D40).
    "toolbox:list": async ({ list, offset, limit }) =>
      toolboxList(await catalog.snapshot(), list, find.state().rules.archiveDays, offset, limit),
    "toolbox:archived": async (request) =>
      readArchived(pipelineDb(), request, await archivedNames()),
    "toolbox:restore": ({ ids }) =>
      context.archive?.restore(ids) ?? { ok: false as const, problem: "no_python" as const },
    // The sweep runs in the background; the list reads again on the catalog's change.
    "toolbox:sweep": () => {
      context.archive?.sweep();
      return {};
    },
    "toolbox:counts": async () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return toolboxCounts(
        (await catalog.snapshot()).rows,
        countArchived(pipelineDb()),
        await openSource().logSince(midnight.getTime()),
      );
    },
    // Plan step P8a: Insights (local reads and local settings; none is refused in prototype mode).
    "insights:read": ({ tab, period, deals }) => insightsService().read(tab, period, deals),
    "insights:list": ({ drill, period, offset, deals }) =>
      insightsService().list(drill, period, offset, deals),
    "insights:hide": ({ key, until }) => insightsService().hide(key, until),
    "insights:goal": (patch) => insightsService().goal(patch),
    "rules:set": ({ rules }) => {
      find.setRules(rules);
      return {};
    },
    "import:candidates": () => importer.candidates(),
    "import:pick": () => importer.pick(),
    "import:dry-run": ({ path }) => importer.dryRun(path),
    "import:run": ({ path, useOldRules }) => importer.run(path, useOldRules),
    "writing:rules": () => writingRules.list(),
    "connections:status": () => connections.status(),
    // The change may carry a secret: it goes to the service and is neither kept nor logged here.
    "connections:set": (change) => connections.set(change),
    "connections:pick-folder": ({ purpose }) => connections.pickFolder(purpose),
    // Prototype mode (ADR 0004, step 7). The prototype stops a running search itself, inside its
    // switch queue (`beforeSwitch`), so nothing can start one between the stop and the switch.
    "prototype:status": () => prototype.status(),
    "prototype:set": ({ on }) => prototype.set(on),
    "prototype:scenario": ({ scenario }) => prototype.setScenario(scenario),
    // Each comment call throws while prototype mode is off (the copy is closed).
    "comments:list": () => ({ comments: prototype.comments.list() }),
    "comments:add": (comment) => prototype.comments.add(comment),
    "comments:update": (patch) => prototype.comments.update(patch),
    "comments:delete": ({ id }) => ({ comment: prototype.comments.remove(id) }),
    "comments:restore": ({ comment }) => prototype.comments.restore(comment),
    "comments:export": () => prototype.comments.exportTo(context.repoRoot ?? null),
    "mail:connect": () => mailConsent.connect(),
    "mail:check": () => connections.checkMailboxes(),
    "gateways:deploy": ({ regions }) => connections.deployGateways(regions),
    "gateways:remove": ({ region }) => connections.removeGateways(region),
    "reach:thread": ({ creatorId }) => reach.thread(creatorId),
    "reach:draft-now": ({ creatorId }) => reach.draftNow(creatorId),
    "reach:rewrite": ({ draftId, how }) => reach.rewrite(draftId, how),
    "reach:retry": ({ draftId }) => reach.retry(draftId),
    "reach:mark-sent": ({ draftId }) => reach.markSent(draftId),
    "reach:send-new": ({ draftId }) => reach.sendNew(draftId),
    "reach:mailboxes-refresh": () => reach.refreshMailboxes(),
    "reach:mailbox-set": (request) => reach.setMailbox(request),
    "reach:send-test": ({ address }) => reach.sendTest(address),
    "reach:sequence-stop": ({ creatorId }) => reach.sequenceStop(creatorId),
    "reach:sequence-resume": ({ creatorId, restore }) => reach.sequenceResume(creatorId, restore),
    "reach:park": ({ creatorId, until }) => reach.park(creatorId, until),
    "reach:wake": ({ creatorId, restore }) => reach.wake(creatorId, restore),
    "close:decline": ({ creatorId }) => reach.decline(creatorId),
    "close:decline-undo": (request) => reach.undoDecline(request),
    "close:ask": ({ creatorId }) => reach.ask(creatorId),
    "reach:check-replies": () => reach.checkReplies(),
    "reach:paste-reply": ({ creatorId, text }) => reach.pasteReply(creatorId, text),
    "reach:reclassify": ({ messageId, replyType }) => reach.reclassify(messageId, replyType),
    "reach:situations": () => reach.situations(),
    "gemini:start": () => gemini.start(),
    "gemini:stop": () => gemini.stop(),
    "gemini:open-window": ({ browser }) => gemini.openWindow(browser),
  };
}
