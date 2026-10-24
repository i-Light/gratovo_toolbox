import type { DataSource } from "@gratovo/core/data";

import { readAwsKeys, readMailSecrets } from "../pipeline/pipeline-secrets";
import { protocolVersion, type Start } from "../pipeline/protocol";

import type { ConnectionsDeps } from "./connections-service";
import { sameAddress, startSettings } from "./connections-store";

/**
 * The start message for a quick job (`mail.status`, `gateways.*`), with only the secrets that job
 * needs. Null when no live data is open.
 */
export async function buildQuickStart(
  deps: Pick<ConnectionsDeps, "jobContext" | "secrets">,
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
  const mail = needs.mail === true ? await readMailSecrets(deps.secrets) : undefined;
  const aws = needs.aws === true ? await readAwsKeys(deps.secrets) : undefined;
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
