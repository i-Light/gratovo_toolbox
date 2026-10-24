import type { DataSource } from "@gratovo/core/data";
import { z } from "zod";

import { pipelineSecretNames } from "../pipeline/pipeline-secrets";
import { startSchema, type Start } from "../pipeline/protocol";
import type { SecretStore } from "../secret-store";

/**
 * Reading what Settings › Connections keeps (plan D7): the open source's `local_settings` rows and
 * the secret store's mailbox tokens. Every reader falls back to the defaults on a missing or
 * malformed value, so a bad row never stops the screen.
 */

export const defaultMailLabel = "Gratovo Outreach";
/** The proxy URLs, a JSON list (named as in step 3e). */
export const proxiesSecretName = "pipeline.proxies";
/** How many Gmail mailboxes can be connected. */
export const maxMailboxes = 20;

const settingsShape = startSchema.shape.settings.shape;
const secretsShape = startSchema.shape.secrets.shape;
const mailSettingsShape = settingsShape.mail.unwrap().shape;
export const mailSecretShape = secretsShape.mail.unwrap().shape;
export const awsKeysSchema = secretsShape.aws.unwrap();

const mailboxRow = mailSettingsShape.mailboxes.element;
export type MailboxRow = z.infer<typeof mailboxRow>;

export interface MailRows {
  label: string;
  senderName: string | null;
  mailboxes: MailboxRow[];
}

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

export const sameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export function readMailRows(source: DataSource | null): MailRows {
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

export function readPipelineSettings(source: DataSource | null) {
  const parsed = pipelineSettingsSchema.safeParse(source?.readSetting("pipeline.settings") ?? {});
  return parsed.success ? parsed.data : pipelineSettingsSchema.parse({});
}

export function readCourse(source: DataSource | null) {
  return courseSchema.parse(source?.readSetting("course") ?? {});
}

/** The last import (`at` and the backup folder), or null when it never ran. */
export function readImport(source: DataSource | null) {
  const parsed = importSchema.safeParse(source?.readSetting("import"));
  return parsed.success ? parsed.data : null;
}

/**
 * The start message's `settings`: pacing, parallel, proxies, and the mail settings once a mailbox
 * is connected. `{mail: false}` leaves the mail settings out (a search needs no mailbox, so its
 * start message carries no address).
 */
export function startSettings(
  source: DataSource | null,
  options: { mail?: boolean } = {},
): Start["settings"] {
  const settings: Start["settings"] = { ...readPipelineSettings(source) };
  if (options.mail === false) {
    return settings;
  }
  const mail = readMailRows(source);
  if (mail.mailboxes.length > 0) {
    settings.mail = { label: mail.label, senderName: mail.senderName, mailboxes: mail.mailboxes };
  }
  return settings;
}

/** A secret's JSON, or undefined when it is missing or not JSON. */
export async function readSecretJson(secrets: SecretStore, name: string): Promise<unknown> {
  try {
    const raw = await secrets.get(name);
    return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** The stored mailbox tokens (`mail.mailboxes`); empty when missing or malformed. */
export async function readTokens(
  secrets: SecretStore,
): Promise<{ address: string; refreshToken: string }[]> {
  const parsed = mailSecretShape.mailboxes.safeParse(
    await readSecretJson(secrets, pipelineSecretNames.mailboxes),
  );
  return parsed.success ? parsed.data : [];
}
