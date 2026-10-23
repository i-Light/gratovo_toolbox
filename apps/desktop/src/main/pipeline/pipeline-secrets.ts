import { z } from "zod";

import type { SecretStore } from "../secret-store";

import { startSchema, type ResultData, type Start } from "./protocol";

/**
 * The pipeline's secrets in the secret store, read and written as checked JSON (plan D19, D21).
 * A value that isn't JSON or doesn't fit its shape is treated as missing and logged by its name
 * only: no value ever reaches a log or an error message.
 *
 * `pipeline.gateways` holds `{enabled, gateways: [{region, apiId, url}]}`. The plain list of URLs
 * the first version kept is still read, as enabled, with no API ids. Only the gateway jobs and the
 * Settings card (step 9) change it.
 */

export const pipelineSecretNames = {
  mailClient: "mail.client",
  mailboxes: "mail.mailboxes",
  awsKeys: "aws.keys",
  gateways: "pipeline.gateways",
} as const;

// The start message's own schemas, so what is stored always fits what is sent.
const secretsShape = startSchema.shape.secrets.shape;
const mailShape = secretsShape.mail.unwrap().shape;
const awsKeysSchema = secretsShape.aws.unwrap();

// As in protocol.ts.
const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);
const apiId = z.string().regex(/^[a-z0-9]{1,32}$/);
const url = z.string().min(1).max(2000);
const maxGateways = 100;

const gatewayStateSchema = z.strictObject({
  enabled: z.boolean(),
  gateways: z
    .array(z.strictObject({ region: region.nullable(), apiId: apiId.nullable(), url }))
    .max(maxGateways),
});

export type GatewayState = z.infer<typeof gatewayStateSchema>;
export type Gateway = GatewayState["gateways"][number];

/** The region in a gateway's host, `<id>.execute-api.<region>.amazonaws.com`, or null. */
function regionOf(raw: string): string | null {
  try {
    const match = /^[a-z0-9]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/.exec(
      new URL(raw).hostname,
    );
    const found = match?.[1];
    return found !== undefined && region.safeParse(found).success ? found : null;
  } catch {
    return null;
  }
}

const storedGatewaysSchema = z.union([
  gatewayStateSchema,
  z
    .array(url)
    .max(maxGateways)
    .transform((urls): GatewayState => ({
      enabled: true,
      gateways: urls.map((u) => ({ region: regionOf(u), apiId: null, url: u })),
    })),
]);

const noGateways = (): GatewayState => ({ enabled: false, gateways: [] });

type Reader = Pick<SecretStore, "get">;
type Writer = Pick<SecretStore, "get" | "set">;

/**
 * One secret, parsed. Missing, not JSON or the wrong shape → undefined (the last two logged by
 * name). A store that can't be read is logged and treated as missing too, unless `forWrite`: a
 * writer must not replace a value it couldn't read.
 */
async function readSecret<T>(
  store: Reader,
  name: string,
  schema: z.ZodType<T>,
  forWrite = false,
): Promise<T | undefined> {
  let raw: string | undefined;
  try {
    raw = await store.get(name);
  } catch (error) {
    if (forWrite) {
      throw error;
    }
    console.error(`Pipeline secrets: "${name}" couldn't be read, so it is treated as missing.`);
    return undefined;
  }
  if (raw === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(`Pipeline secrets: "${name}" isn't in the expected shape; treated as missing.`);
    return undefined;
  }
  return parsed.data;
}

/** The Gmail client and the connected mailboxes; undefined without a client. */
export async function readMailSecrets(store: Reader): Promise<Start["secrets"]["mail"]> {
  const client = await readSecret(store, pipelineSecretNames.mailClient, mailShape.client);
  if (client === undefined) {
    return undefined;
  }
  // A client with no mailbox connected yet is a real state: the jobs answer `mail_not_connected`.
  const mailboxes = await readSecret(store, pipelineSecretNames.mailboxes, mailShape.mailboxes);
  return { client, mailboxes: mailboxes ?? [] };
}

export function readAwsKeys(store: Reader): Promise<Start["secrets"]["aws"]> {
  return readSecret(store, pipelineSecretNames.awsKeys, awsKeysSchema);
}

export async function readGateways(store: Reader): Promise<GatewayState> {
  return (
    (await readSecret(store, pipelineSecretNames.gateways, storedGatewaysSchema)) ?? noGateways()
  );
}

/** The URLs a search routes through: none while the gateways are turned off. */
export async function gatewayUrlsForSearch(store: Reader): Promise<string[]> {
  const state = await readGateways(store);
  return state.enabled ? state.gateways.map((gateway) => gateway.url) : [];
}

// Each change reads, changes and writes the whole value. Queued per store, so a toggle that lands
// while a deploy's result is being saved can't write over it.
const queues = new WeakMap<object, Promise<unknown>>();

function change(
  store: Writer,
  edit: (state: GatewayState) => GatewayState | null,
): Promise<GatewayState> {
  const before = queues.get(store) ?? Promise.resolve();
  const task = before.then(async () => {
    const current =
      (await readSecret(store, pipelineSecretNames.gateways, storedGatewaysSchema, true)) ??
      noGateways();
    const next = edit(current);
    if (next === null) {
      return current;
    }
    const checked = gatewayStateSchema.safeParse(next);
    if (!checked.success) {
      throw new Error(`The gateways don't fit "${pipelineSecretNames.gateways}".`);
    }
    await store.set(pipelineSecretNames.gateways, JSON.stringify(checked.data));
    return checked.data;
  });
  queues.set(
    store,
    task.catch(() => undefined),
  );
  return task;
}

/**
 * Merges a `gateways.deploy` result: a region deployed again replaces its old entry. Deploying any
 * turns them on.
 */
export function saveDeployedGateways(
  store: Writer,
  data: ResultData<"gateways.deploy">,
): Promise<GatewayState> {
  return change(store, (current) => {
    if (data.deployed.length === 0) {
      return null;
    }
    const byRegion = new Map(
      data.deployed.map(({ region: r, apiId: id, url: u }) => [
        r,
        { region: r, apiId: id, url: u },
      ]),
    );
    const kept = current.gateways.filter((g) => g.region === null || !byRegion.has(g.region));
    return { enabled: true, gateways: [...kept, ...byRegion.values()].slice(-maxGateways) };
  });
}

/** Drops the gateways a `gateways.destroy` deleted. With none left, they are off. */
export function removeGateways(
  store: Writer,
  deleted: ResultData<"gateways.destroy">["deleted"],
): Promise<GatewayState> {
  return change(store, (current) => {
    const gone = (g: Gateway) => deleted.some((d) => d.region === g.region && d.apiId === g.apiId);
    const gateways = current.gateways.filter((g) => !gone(g));
    if (gateways.length === current.gateways.length) {
      return null;
    }
    return { enabled: current.enabled && gateways.length > 0, gateways };
  });
}

export function setGatewaysEnabled(store: Writer, enabled: boolean): Promise<GatewayState> {
  return change(store, (current) => ({ enabled, gateways: current.gateways }));
}
