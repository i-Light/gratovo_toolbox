import { describe, expect, it } from "vitest";

import { laneFor, runJob } from "./jobs";
import type { JobKind, PipelineMessage, ReplyMessage, ResultMessage, Start } from "./protocol";
import type { JobHandlers, PipelineSupervisor } from "./supervisor";

function fakeSupervisor(problem: "running" | "no_python" | null = null) {
  const fake = {
    starts: [] as Start[],
    handlers: null as JobHandlers | null,
    start(start: Start, handlers: JobHandlers): ReturnType<PipelineSupervisor["start"]> {
      if (problem !== null) {
        return { ok: false, problem };
      }
      fake.starts.push(start);
      fake.handlers = handlers;
      return { ok: true };
    },
  };
  return fake;
}

const start: Start = {
  type: "start",
  protocol: 1,
  source: "live",
  dataDir: "D:\\mail",
  worker: "user-1",
  job: { kind: "mail.replies" },
  settings: {},
  secrets: { youtubeKey: null, proxyUrls: [], gatewayUrls: [] },
};

const reply = (messageId: string): ReplyMessage => ({
  type: "reply",
  account: "outreach@example.com",
  conversationKey: "UC_ai_daily",
  channelId: "UC_ai_daily",
  messageId,
  from: "creator@example.com",
  fromName: "AI Daily",
  subject: "Re: AI tools review",
  body: "Sounds good, send the brief for the AI coding tool.",
  bodyCut: false,
  receivedAt: null,
  isFirstReply: messageId === "m1",
  cancelledFollowUps: 0,
});

const result: ResultMessage = { type: "result", kind: "mail.replies", data: { accounts: [] } };
const end = { type: "end", state: "done", at: 0, found: 0, kept: 0 } as const;

describe("laneFor", () => {
  it.each<[JobKind, "store" | "quick"]>([
    ["search", "store"],
    ["refetch", "store"],
    ["backfill", "store"],
    // It writes pipeline.db, so never beside a search (the plan's "main lane").
    ["import.legacy", "store"],
    // They write pipeline.db too (plan step 5d, D37 and D38).
    ["archive.sweep", "store"],
    ["archive.restore", "store"],
    ["mail.status", "quick"],
    ["mail.send", "quick"],
    ["mail.replies", "quick"],
    ["mail.ack", "quick"],
    ["mail.cancel", "quick"],
    ["video_stats", "quick"],
    ["gateways.deploy", "quick"],
    ["gateways.destroy", "quick"],
    ["gateways.test", "quick"],
  ])("puts %s in the %s lane", (kind, lane) => {
    expect(laneFor(kind)).toBe(lane);
  });
});

describe("runJob", () => {
  it("collects the replies and resolves with the exit", async () => {
    const supervisor = fakeSupervisor();
    const seen: PipelineMessage[] = [];
    const running = runJob(supervisor, start, { onMessage: (m) => seen.push(m) });

    expect(supervisor.starts).toEqual([start]);
    supervisor.handlers?.onMessage({ type: "log", level: "info", text: "Checking 1 mailbox." });
    supervisor.handlers?.onMessage(reply("m1"));
    supervisor.handlers?.onMessage(reply("m2"));
    supervisor.handlers?.onMessage(result);
    supervisor.handlers?.onMessage(end);
    supervisor.handlers?.onExit({ kind: "ended", end, result });

    expect(await running).toEqual({
      ok: true,
      exit: { kind: "ended", end, result },
      replies: [reply("m1"), reply("m2")],
    });
    expect(seen.map((m) => m.type)).toEqual(["log", "reply", "reply", "result", "end"]);
  });

  it("resolves with a failed exit too", async () => {
    const supervisor = fakeSupervisor();
    const running = runJob(supervisor, start);
    supervisor.handlers?.onExit({ kind: "failed", reason: "crash" });

    expect(await running).toEqual({
      ok: true,
      exit: { kind: "failed", reason: "crash" },
      replies: [],
    });
  });

  it.each(["running", "no_python"] as const)(
    "resolves at once when the job can't start (%s)",
    async (problem) => {
      expect(await runJob(fakeSupervisor(problem), start)).toEqual({ ok: false, problem });
    },
  );

  it("rejects when the start message breaks its schema", async () => {
    const supervisor = {
      start: (): never => {
        throw new Error("bad start");
      },
    };
    await expect(runJob(supervisor, start)).rejects.toThrow("bad start");
  });
});
