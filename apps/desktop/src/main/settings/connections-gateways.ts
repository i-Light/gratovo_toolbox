import type { GatewaysDeployResult, GatewaysRemoveResult } from "@gratovo/ipc";

import {
  readAwsKeys,
  readGateways,
  removeGateways as dropGateways,
  saveDeployedGateways,
} from "../pipeline/pipeline-secrets";

import { buildQuickStart } from "./connections-jobs";
import type { ConnectionsDeps } from "./connections-service";

/**
 * The AWS gateways (plan D11): deployed and removed through the existing `gateways.*` jobs on the
 * quick lane, one gateway job at a time. Only regions reach the page, never an id or URL.
 */

const maxGateways = 100;

export interface Gateways {
  deploy: (regions: readonly string[]) => Promise<GatewaysDeployResult>;
  remove: (region: string) => Promise<GatewaysRemoveResult>;
}

export function createGateways(
  deps: Pick<ConnectionsDeps, "secrets" | "source" | "pythonPath" | "jobContext" | "runQuickJob">,
  /** Sends the fresh status to the page. */
  publish: () => Promise<unknown>,
): Gateways {
  const { secrets } = deps;
  let running = false;

  /** Room for `count` more gateways: entries with no api id are the ones a merge may drop. */
  async function hasRoom(count: number): Promise<boolean> {
    const kept = (await readGateways(secrets)).gateways.filter((g) => g.apiId !== null).length;
    return kept + count <= maxGateways;
  }

  /** What every gateway job needs first; null when it may go ahead. */
  async function blocker(): Promise<"no_data" | "no_python" | "running" | "no_keys" | null> {
    if (deps.source() === null) {
      return "no_data";
    }
    if (deps.pythonPath() === null) {
      return "no_python";
    }
    if (running) {
      return "running";
    }
    if ((await readAwsKeys(secrets)) === undefined) {
      return "no_keys";
    }
    return null;
  }

  async function deploy(regions: readonly string[]): Promise<GatewaysDeployResult> {
    const source = deps.source();
    const blocked = await blocker();
    if (blocked !== null || source === null) {
      return { ok: false, reason: blocked ?? "no_data" };
    }
    if (!(await hasRoom(regions.length))) {
      return { ok: false, reason: "too_many" };
    }
    const start = await buildQuickStart(
      deps,
      source,
      { kind: "gateways.deploy", regions: [...regions] },
      { aws: true },
    );
    if (start === null) {
      return { ok: false, reason: "no_data" };
    }
    running = true;
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
      await publish();
      return {
        ok: true,
        deployed: [...new Set(exit.result.data.deployed.map((d) => d.region))],
        failed: [...new Set(exit.result.data.failed.map((d) => d.region))],
      };
    } finally {
      running = false;
    }
  }

  async function remove(region: string): Promise<GatewaysRemoveResult> {
    const source = deps.source();
    const blocked = await blocker();
    if (blocked !== null || source === null) {
      return { ok: false, reason: blocked ?? "no_data" };
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
    const start = await buildQuickStart(
      deps,
      source,
      { kind: "gateways.destroy", gateways: targets.slice(0, 50) },
      { aws: true },
    );
    if (start === null) {
      return { ok: false, reason: "no_data" };
    }
    running = true;
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
      await publish();
      return { ok: true, removed: exit.result.data.deleted.length };
    } finally {
      running = false;
    }
  }

  return { deploy, remove };
}
