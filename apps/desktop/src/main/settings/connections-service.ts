import { isAbsolute } from "node:path";

import type { DataSource } from "@gratovo/core/data";
import type {
  ConnectionsChange,
  ConnectionsSetResult,
  ConnectionsStatus,
  FolderPurpose,
  GatewaysDeployResult,
  GatewaysRemoveResult,
  MailCheckResult,
  PickedPath,
  SyncState,
} from "@gratovo/ipc";
import { z } from "zod";

import type { JobOutcome } from "../pipeline/jobs";
import {
  pipelineSecretNames,
  readAwsKeys,
  readGateways,
  readMailSecrets,
  removeGateways as dropGateways,
  saveDeployedGateways,
  setGatewaysEnabled,
} from "../pipeline/pipeline-secrets";
import { protocolVersion, startSchema, type Start } from "../pipeline/protocol";
import type { SecretStore } from "../secret-store";
import type { ConnectionsService, GeminiControl } from "../services";

/**
 * Settings › Connections (plan D7, D11). Settings live in the open source's `local_settings`;
 * secrets live in the secret store. `status()` answers counts and flags, never a secret value.
 * Nothing here imports Electron: dialogs and jobs come in as functions.
 */

export const defaultMailLabel = "Gratovo Outreach";
/** How many Gmail mailboxes can be connected. */
export const maxMailboxes = 20;
const maxGateways = 100;
const defaultCap = 20;

const settingsShape = startSchema.shape.settings.shape;
const secretsShape = startSchema.shape.secrets.shape;
const mailSettingsShape = settingsShape.mail.unwrap().shape;
const mailSecretShape = secretsShape.mail.unwrap().shape;
const awsKeysSchema = secretsShape.aws.unwrap();

const mailboxRow = mailSettingsShape.mailboxes.element;
type MailboxRow = z.infer<typeof mailboxRow>;

const mailSettingsSchema = z.object({
  label: mailSettingsShape.label.catch(defaultMailLabel).default(defaultMailLabel),
  senderName: mailSettingsShape.senderName.catch(null).default(null),
  mailboxes: z.array(z.unknown()).default([]),
});

const pipelineSettingsSchema = z.object({
  pacing: settingsShape.pacing.unwrap().catch("normal").default("normal"),
  parallel: settingsShape.parallel
    .unwrap()
    .catch({ enabled: false, maxWorkers: 4 })
    .default({ enabled: false, maxWorkers: 4 }),
  proxies: settingsShape.proxies
    .unwrap()
    .catch({ enabled: false, includeDirect: true })
    .default({ enabled: false, includeDirect: true }),
});

const courseSchema = z.object({
  courseDir: z.string().min(1).max(1024).nullable().catch(null).default(null),
  videoDir: z.string().min(1).max(1024).nullable().catch(null).default(null),
});

const importSchema = z.object({
  at: z.iso.datetime(),
  backup: z.string().min(1).max(1024).nullable().catch(null).default(null),
});

const proxyListSchema = z.array(z.string());

export interface ConnectionsDeps {
  secrets: SecretStore;
  /** The open data source, or null (signed out). */
  source(): DataSource | null;
  gemini: Pick<GeminiControl, "status">;
  pythonPath(): string | null;
  youtubeKeyAvailable(): Promise<boolean>;
  syncState(): SyncState;
  /** Where a non-search job runs: the data folder and worker id; null when no live data is open. */
  jobContext(): { dataDir: string; worker: string } | null;
  /** Runs one job on the quick lane to its end. */
  runQuickJob(start: Start): Promise<JobOutcome>;
  pickFolder(purpose: FolderPurpose): Promise<string | null>;
  pathExists(path: string): Promise<boolean>;
  emit(status: ConnectionsStatus): void;
  now?: () => number;
}

export type AddMailboxResult =
  { ok: true } | { ok: false; reason: "no_data" | "too_many" | "failed" };

export interface ConnectionsServiceFull extends ConnectionsService {
  /** Stores a consented mailbox's token and gives it default settings. Not an IPC channel. */
  addMailbox(address: string, refreshToken: string): Promise<AddMailboxResult>;
}

function readMailRows(source: DataSource | null): {
  label: string;
  senderName: string | null;
  mailboxes: MailboxRow[];
} {
  const parsed = mailSettingsSchema.safeParse(source?.readSetting("mail.settings") ?? {});
  const base = parsed.success
    ? parsed.data
    : { label: defaultMailLabel, senderName: null, mailboxes: [] };
  const mailboxes: MailboxRow[] = [];
  for (const raw of base.mailboxes) {
    const row = mailboxRow.safeParse(raw);
    if (row.success && mailboxes.length < maxMailboxes) {
      mailboxes.push(row.data);
    }
  }
  return { label: base.label, senderName: base.senderName, mailboxes };
}

function readPipelineSettings(source: DataSource | null) {
  const parsed = pipelineSettingsSchema.safeParse(source?.readSetting("pipeline.settings") ?? {});
  return parsed.success ? parsed.data : pipelineSettingsSchema.parse({});
}

/**
 * The start message's `settings` for every job: pacing, parallel, proxies, and the mail settings
 * once a mailbox is connected.
 */
export function startSettings(source: DataSource | null): Start["settings"] {
  const settings: Start["settings"] = { ...readPipelineSettings(source) };
  const mail = readMailRows(source);
  if (mail.mailboxes.length > 0) {
    settings.mail = { label: mail.label, senderName: mail.senderName, mailboxes: mail.mailboxes };
  }
  return settings;
}

const sameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const proxyProtocols = new Set(["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"]);

function isProxyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return proxyProtocols.has(url.protocol) && url.hostname !== "";
  } catch {
    return false;
  }
}

function gatewayRegionsOf(list: readonly { region: string | null }[]): string[] {
  const regions = new Set<string>();
  for (const g of list) {
    if (g.region !== null) {
      regions.add(g.region);
    }
  }
  return [...regions].sort();
}

export function createConnectionsService(deps: ConnectionsDeps): ConnectionsServiceFull {
  const { secrets } = deps;
  const now = deps.now ?? Date.now;
  // The last `mail.status` answer per address (lower case); kept in memory only.
  const health = new Map<string, { health: "ok" | "signed-out" | "error"; checkedAt: string }>();
  let gatewayJobRunning = false;

  async function readJson(name: string): Promise<unknown> {
    try {
      const raw = await secrets.get(name);
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  async function readTokens(): Promise<{ address: string; refreshToken: string }[]> {
    const parsed = mailSecretShape.mailboxes.safeParse(
      await readJson(pipelineSecretNames.mailboxes),
    );
    return parsed.success ? parsed.data : [];
  }

  async function status(): Promise<ConnectionsStatus> {
    const source = deps.source();
    const mail = readMailRows(source);
    const settings = readPipelineSettings(source);
    const course = courseSchema.parse(source?.readSetting("course") ?? {});
    const imported = importSchema.safeParse(source?.readSetting("import"));
    const proxies = proxyListSchema.safeParse(await readJson("pipeline.proxies"));
    const gateways = await readGateways(secrets);
    let youtube: boolean;
    try {
      youtube = await deps.youtubeKeyAvailable();
    } catch {
      youtube = false;
    }
    return {
      python: { state: deps.pythonPath() === null ? "missing" : "ready" },
      youtube: { state: youtube ? "available" : "unavailable" },
      gemini: await deps.gemini.status(),
      mailApp: { set: await secrets.has(pipelineSecretNames.mailClient) },
      mailboxes: mail.mailboxes.map((row) => {
        const seen = health.get(row.address.toLowerCase());
        return {
          address: row.address,
          dailyCap: row.dailyCap,
          warmupStartedOn: row.warmupStartedOn,
          health: seen?.health ?? "unknown",
          checkedAt: seen?.checkedAt ?? null,
        };
      }),
      mail: { label: mail.label, senderName: mail.senderName },
      proxies: {
        count: proxies.success ? Math.min(proxies.data.length, 100) : 0,
        enabled: settings.proxies.enabled,
        includeDirect: settings.proxies.includeDirect,
      },
      pacing: settings.pacing,
      parallel: settings.parallel,
      aws: {
        keys: await secrets.has(pipelineSecretNames.awsKeys),
        enabled: gateways.enabled,
        regions: gatewayRegionsOf(gateways.gateways).slice(0, 100),
      },
      course: {
        courseDir: course.courseDir,
        videoDir: course.videoDir,
        courseFound: course.courseDir !== null && (await deps.pathExists(course.courseDir)),
      },
      sync: { state: deps.syncState() },
      import: imported.success
        ? { state: "done", at: imported.data.at, backup: imported.data.backup }
        : { state: "never", at: null, backup: null },
    };
  }

  async function apply(
    change: ConnectionsChange,
    source: DataSource,
  ): Promise<ConnectionsSetResult> {
    const ok = { ok: true } as const;
    switch (change.kind) {
      case "mail.client": {
        const id = change.id.trim();
        const secret = change.secret.trim();
        const client = mailSecretShape.client.safeParse({ id, secret });
        if (!client.success) {
          return { ok: false, reason: "failed" };
        }
        await secrets.set(pipelineSecretNames.mailClient, JSON.stringify(client.data));
        return ok;
      }
      case "mail.settings": {
        const mail = readMailRows(source);
        const label = change.label.trim();
        if (label === "") {
          return { ok: false, reason: "failed" };
        }
        source.writeSetting("mail.settings", { ...mail, label, senderName: change.senderName });
        return ok;
      }
      case "mailbox.update": {
        const mail = readMailRows(source);
        if (!mail.mailboxes.some((m) => sameAddress(m.address, change.address))) {
          return { ok: false, reason: "unknown_mailbox" };
        }
        source.writeSetting("mail.settings", {
          ...mail,
          mailboxes: mail.mailboxes.map((m) =>
            sameAddress(m.address, change.address)
              ? {
                  address: m.address,
                  dailyCap: change.dailyCap,
                  warmupStartedOn: change.warmupStartedOn,
                }
              : m,
          ),
        });
        return ok;
      }
      case "mailbox.remove": {
        const mail = readMailRows(source);
        const tokens = await readTokens();
        const inRows = mail.mailboxes.some((m) => sameAddress(m.address, change.address));
        const inTokens = tokens.some((t) => sameAddress(t.address, change.address));
        if (!inRows && !inTokens) {
          return { ok: false, reason: "unknown_mailbox" };
        }
        if (inTokens) {
          await secrets.set(
            pipelineSecretNames.mailboxes,
            JSON.stringify(tokens.filter((t) => !sameAddress(t.address, change.address))),
          );
        }
        source.writeSetting("mail.settings", {
          ...mail,
          mailboxes: mail.mailboxes.filter((m) => !sameAddress(m.address, change.address)),
        });
        health.delete(change.address.trim().toLowerCase());
        return ok;
      }
      case "proxies.urls": {
        const urls = change.urls.map((u) => u.trim());
        if (!urls.every(isProxyUrl)) {
          return { ok: false, reason: "failed" };
        }
        if (urls.length === 0) {
          await secrets.delete("pipeline.proxies");
        } else {
          await secrets.set("pipeline.proxies", JSON.stringify(urls));
        }
        return ok;
      }
      case "pipeline.settings":
        source.writeSetting("pipeline.settings", {
          pacing: change.pacing,
          parallel: change.parallel,
          proxies: change.proxies,
        });
        return ok;
      case "aws.keys": {
        const keys = awsKeysSchema.safeParse({
          accessKeyId: change.accessKeyId,
          secretAccessKey: change.secretAccessKey.trim(),
        });
        if (!keys.success) {
          return { ok: false, reason: "failed" };
        }
        await secrets.set(pipelineSecretNames.awsKeys, JSON.stringify(keys.data));
        return ok;
      }
      case "gateways.enabled":
        await setGatewaysEnabled(secrets, change.enabled);
        return ok;
      case "course": {
        for (const dir of [change.courseDir, change.videoDir]) {
          if (dir !== null && !isAbsolute(dir)) {
            return { ok: false, reason: "failed" };
          }
        }
        source.writeSetting("course", { courseDir: change.courseDir, videoDir: change.videoDir });
        return ok;
      }
    }
  }

  async function set(change: ConnectionsChange): Promise<ConnectionsSetResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    let result: ConnectionsSetResult;
    try {
      result = await apply(change, source);
    } catch {
      console.error(`Connections: saving "${change.kind}" failed.`);
      return { ok: false, reason: "failed" };
    }
    if (result.ok) {
      deps.emit(await status());
    }
    return result;
  }

  /** The start message for a quick job, with only the secrets that job needs. */
  async function buildStart(
    source: DataSource,
    job: Start["job"],
    needs: { mail?: boolean; aws?: boolean },
  ): Promise<Start | null> {
    const context = deps.jobContext();
    if (context === null) {
      return null;
    }
    const settings = startSettings(source);
    const listed = (settings.mail?.mailboxes ?? []).map((m) => m.address);
    const mail = needs.mail === true ? await readMailSecrets(secrets) : undefined;
    const aws = needs.aws === true ? await readAwsKeys(secrets) : undefined;
    return {
      type: "start",
      protocol: protocolVersion,
      source: "live",
      dataDir: context.dataDir,
      worker: context.worker,
      job,
      settings,
      secrets: {
        youtubeKey: null,
        proxyUrls: [],
        gatewayUrls: [],
        ...(mail === undefined
          ? {}
          : {
              mail: {
                client: mail.client,
                mailboxes: mail.mailboxes.filter((m) =>
                  listed.some((a) => sameAddress(a, m.address)),
                ),
              },
            }),
        ...(aws === undefined ? {} : { aws }),
      },
    };
  }

  async function checkMailboxes(): Promise<MailCheckResult> {
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
    const start = await buildStart(source, { kind: "mail.status" }, { mail: true });
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
      let state: "ok" | "signed-out" | "error" = "ok";
      if (account.error !== null) {
        state = account.error.code === "mail_auth" ? "signed-out" : "error";
      } else if (!account.connected) {
        state = "signed-out";
      }
      health.set(account.account.trim().toLowerCase(), { health: state, checkedAt: at });
    }
    const fresh = await status();
    deps.emit(fresh);
    return { ok: true, mailboxes: fresh.mailboxes };
  }

  /** Room for `count` more gateways: entries with no api id are the ones a merge may drop. */
  async function hasRoom(count: number): Promise<boolean> {
    const kept = (await readGateways(secrets)).gateways.filter((g) => g.apiId !== null).length;
    return kept + count <= maxGateways;
  }

  async function deployGateways(regions: readonly string[]): Promise<GatewaysDeployResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    if (deps.pythonPath() === null) {
      return { ok: false, reason: "no_python" };
    }
    if (gatewayJobRunning) {
      return { ok: false, reason: "running" };
    }
    if ((await readAwsKeys(secrets)) === undefined) {
      return { ok: false, reason: "no_keys" };
    }
    if (!(await hasRoom(regions.length))) {
      return { ok: false, reason: "too_many" };
    }
    const start = await buildStart(
      source,
      { kind: "gateways.deploy", regions: [...regions] },
      { aws: true },
    );
    if (start === null) {
      return { ok: false, reason: "no_data" };
    }
    gatewayJobRunning = true;
    try {
      const outcome = await deps.runQuickJob(start);
      if (!outcome.ok) {
        return { ok: false, reason: outcome.problem === "no_python" ? "no_python" : "running" };
      }
      const exit = outcome.exit;
      if (exit.kind !== "ended") {
        return { ok: false, reason: "failed" };
      }
      if (exit.end.error?.code === "no_aws_keys") {
        return { ok: false, reason: "no_keys" };
      }
      if (exit.end.state !== "done" || exit.result?.kind !== "gateways.deploy") {
        return { ok: false, reason: "failed" };
      }
      try {
        await saveDeployedGateways(secrets, exit.result.data);
      } catch {
        console.error("Connections: the deployed gateways couldn't be saved.");
        return { ok: false, reason: "failed" };
      }
      deps.emit(await status());
      return {
        ok: true,
        deployed: [...new Set(exit.result.data.deployed.map((d) => d.region))],
        failed: [...new Set(exit.result.data.failed.map((d) => d.region))],
      };
    } finally {
      gatewayJobRunning = false;
    }
  }

  async function removeGateways(region: string): Promise<GatewaysRemoveResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    if (deps.pythonPath() === null) {
      return { ok: false, reason: "no_python" };
    }
    if (gatewayJobRunning) {
      return { ok: false, reason: "running" };
    }
    if ((await readAwsKeys(secrets)) === undefined) {
      return { ok: false, reason: "no_keys" };
    }
    const targets: { region: string; apiId: string }[] = [];
    for (const g of (await readGateways(secrets)).gateways) {
      if (g.region === region && g.apiId !== null) {
        targets.push({ region, apiId: g.apiId });
      }
    }
    if (targets.length === 0) {
      return { ok: true, removed: 0 };
    }
    const start = await buildStart(
      source,
      { kind: "gateways.destroy", gateways: targets.slice(0, 50) },
      { aws: true },
    );
    if (start === null) {
      return { ok: false, reason: "no_data" };
    }
    gatewayJobRunning = true;
    try {
      const outcome = await deps.runQuickJob(start);
      if (!outcome.ok) {
        return { ok: false, reason: outcome.problem === "no_python" ? "no_python" : "running" };
      }
      const exit = outcome.exit;
      if (exit.kind !== "ended") {
        return { ok: false, reason: "failed" };
      }
      if (exit.end.error?.code === "no_aws_keys") {
        return { ok: false, reason: "no_keys" };
      }
      if (exit.end.state !== "done" || exit.result?.kind !== "gateways.destroy") {
        return { ok: false, reason: "failed" };
      }
      try {
        await dropGateways(secrets, exit.result.data.deleted);
      } catch {
        console.error("Connections: the removed gateways couldn't be saved.");
        return { ok: false, reason: "failed" };
      }
      deps.emit(await status());
      return { ok: true, removed: exit.result.data.deleted.length };
    } finally {
      gatewayJobRunning = false;
    }
  }

  async function addMailbox(address: string, refreshToken: string): Promise<AddMailboxResult> {
    const source = deps.source();
    if (source === null) {
      return { ok: false, reason: "no_data" };
    }
    const entry = mailSecretShape.mailboxes.element.safeParse({
      address: address.trim().toLowerCase(),
      refreshToken,
    });
    if (!entry.success) {
      return { ok: false, reason: "failed" };
    }
    try {
      const tokens = await readTokens();
      const mail = readMailRows(source);
      const known =
        tokens.some((t) => sameAddress(t.address, entry.data.address)) ||
        mail.mailboxes.some((m) => sameAddress(m.address, entry.data.address));
      const count = new Set([
        ...tokens.map((t) => t.address.toLowerCase()),
        ...mail.mailboxes.map((m) => m.address.toLowerCase()),
      ]).size;
      if (!known && count >= maxMailboxes) {
        return { ok: false, reason: "too_many" };
      }
      await secrets.set(
        pipelineSecretNames.mailboxes,
        JSON.stringify([
          ...tokens.filter((t) => !sameAddress(t.address, entry.data.address)),
          entry.data,
        ]),
      );
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
      return { ok: false, reason: "failed" };
    }
    deps.emit(await status());
    return { ok: true };
  }

  return {
    status,
    set,
    async pickFolder(purpose): Promise<PickedPath> {
      return { path: await deps.pickFolder(purpose) };
    },
    checkMailboxes,
    deployGateways,
    removeGateways,
    addMailbox,
  };
}
