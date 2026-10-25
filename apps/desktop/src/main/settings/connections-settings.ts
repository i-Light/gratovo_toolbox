import { isAbsolute } from "node:path";

import type { DataSource } from "@gratovo/core/data";
import type { ConnectionsChange, ConnectionsSetResult } from "@gratovo/ipc";

import { forgetMailboxFlags } from "../reach/mailbox-settings";
import { pipelineSecretNames, setGatewaysEnabled } from "../pipeline/pipeline-secrets";
import type { SecretStore } from "../secret-store";

import {
  awsKeysSchema,
  mailSecretShape,
  proxiesSecretName,
  readMailRows,
  readTokens,
  sameAddress,
} from "./connections-store";

/**
 * One change from Settings › Connections (plan D7): a `local_settings` row of the open source, or
 * a set-only secret. Each value is checked before it is written; nothing is read back to the page.
 */

const proxyProtocols = new Set(["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"]);

function isProxyUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return proxyProtocols.has(url.protocol) && url.hostname !== "";
  } catch {
    return false;
  }
}

export interface ApplyContext {
  source: DataSource;
  secrets: SecretStore;
  /** A removed mailbox's last check is forgotten too. */
  forgetMailbox: (address: string) => void;
}

const ok = { ok: true } as const;

/** Writes one change. Throws when the store or the database can't be written. */
export async function applyChange(
  change: ConnectionsChange,
  { source, secrets, forgetMailbox }: ApplyContext,
): Promise<ConnectionsSetResult> {
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
      const tokens = await readTokens(secrets);
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
      forgetMailboxFlags(source, change.address);
      forgetMailbox(change.address);
      return ok;
    }
    case "proxies.urls": {
      const urls = change.urls.map((u) => u.trim());
      if (!urls.every(isProxyUrl)) {
        return { ok: false, reason: "failed" };
      }
      if (urls.length === 0) {
        await secrets.delete(proxiesSecretName);
      } else {
        await secrets.set(proxiesSecretName, JSON.stringify(urls));
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
