import type { ConnectionsStatus } from "@gratovo/ipc";
import { z } from "zod";

import { pipelineSecretNames, readGateways } from "../pipeline/pipeline-secrets";

import type { ConnectionsDeps } from "./connections-service";
import {
  proxiesSecretName,
  readCourse,
  readImport,
  readMailRows,
  readPipelineSettings,
  readSecretJson,
} from "./connections-store";

/**
 * The `connections:status` snapshot (plan D11): counts and flags, never a secret's value.
 */

export type StatusDeps = Pick<
  ConnectionsDeps,
  | "secrets"
  | "source"
  | "gemini"
  | "pythonPath"
  | "youtubeKeyAvailable"
  | "syncState"
  | "pathExists"
>;

/** A mailbox's last `mail.status` answer, by address. */
export type HealthOf = (
  address: string,
) => { health: "ok" | "signed-out" | "error"; checkedAt: string } | undefined;

const proxyListSchema = z.array(z.string());

function gatewayRegionsOf(list: readonly { region: string | null }[]): string[] {
  const regions = new Set<string>();
  for (const g of list) {
    if (g.region !== null) {
      regions.add(g.region);
    }
  }
  return [...regions].sort();
}

export async function buildStatus(
  deps: StatusDeps,
  healthOf: HealthOf,
): Promise<ConnectionsStatus> {
  const { secrets } = deps;
  const source = deps.source();
  const mail = readMailRows(source);
  const settings = readPipelineSettings(source);
  const course = readCourse(source);
  const imported = readImport(source);
  const proxies = proxyListSchema.safeParse(await readSecretJson(secrets, proxiesSecretName));
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
      const seen = healthOf(row.address);
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
    import:
      imported === null
        ? { state: "never", at: null, backup: null }
        : { state: "done", at: imported.at, backup: imported.backup },
  };
}
