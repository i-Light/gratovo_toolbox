import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { keptLogs, openPipelineLog, redact, secretsOf } from "./logs";
import type { Start } from "./protocol";

describe("pipeline logs", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "gratovo-logs-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("writes one stamped file per job, a line per entry", async () => {
    const log = openPipelineLog({
      folder: join(folder, "logs"),
      now: () => Date.UTC(2026, 9, 21, 9, 40),
      secrets: [],
    });
    log.write("info", "Found 5 channel(s).");
    log.write("stderr", "line one\nline two\n");
    log.close();

    const [name] = await readdir(join(folder, "logs"));
    expect(name).toBe("pipeline-2026-10-21T09-40-00-000Z.log");
    expect(await readFile(join(folder, "logs", name ?? ""), "utf8")).toBe(
      "2026-10-21T09:40:00.000Z info Found 5 channel(s).\n" +
        "2026-10-21T09:40:00.000Z stderr line one\n" +
        "2026-10-21T09:40:00.000Z stderr line two\n",
    );
  });

  it(`keeps the newest ${String(keptLogs)}`, async () => {
    for (let i = 0; i < 45; i += 1) {
      await writeFile(
        join(folder, `pipeline-2026-10-01T00-00-${String(i).padStart(2, "0")}-000Z.log`),
        "",
      );
    }
    await writeFile(join(folder, "notes.txt"), "");

    openPipelineLog({ folder, now: () => Date.UTC(2026, 9, 21), secrets: [] }).close();

    const names = (await readdir(folder)).filter((n) => n.startsWith("pipeline-")).sort();
    expect(names).toHaveLength(keptLogs);
    expect(names[0]).toBe("pipeline-2026-10-01T00-00-06-000Z.log");
    expect(names.at(-1)).toBe("pipeline-2026-10-21T00-00-00-000Z.log");
    expect(await readdir(folder)).toContain("notes.txt");
  });

  it("blanks every secret of a job, including the login inside a proxy URL", () => {
    const start = {
      secrets: {
        youtubeKey: "example-key-not-real",
        proxyUrls: ["http://ai-user:proxy-pass-123@proxy.example:8080"],
        gatewayUrls: ["https://abc123.execute-api.us-east-1.amazonaws.com/prod"],
      },
    } as Pick<Start, "secrets">;
    const secrets = secretsOf(start);

    expect(redact("key=example-key-not-real", secrets)).toBe("key=[secret]");
    expect(redact("auth proxy-pass-123 failed", secrets)).toBe("auth [secret] failed");
    expect(redact("via abc123.execute-api.us-east-1.amazonaws.com/prod", secrets)).toBe(
      "via [secret]",
    );
    expect(redact("host abc123.execute-api.us-east-1.amazonaws.com refused", secrets)).toBe(
      "host [secret] refused",
    );
    expect(redact("via proxy.example", secrets)).toBe("via proxy.example");
    // Too short to be a secret worth hiding, and hiding it would blank ordinary words.
    expect(redact("a b", ["a", "b"])).toBe("a b");
  });

  const noUrls = { youtubeKey: null, proxyUrls: [], gatewayUrls: [] };

  it("blanks the mail client's id and secret and every mailbox's refresh token", () => {
    const secrets = secretsOf({
      secrets: {
        ...noUrls,
        mail: {
          client: { id: "example-client.apps.example.com", secret: "example-client-secret" },
          mailboxes: [
            { address: "outreach@example.com", refreshToken: "example-refresh-one" },
            { address: "partners@example.com", refreshToken: "example-refresh-two" },
          ],
        },
      },
    });

    expect(redact("client example-client.apps.example.com", secrets)).toBe("client [secret]");
    expect(redact("secret=example-client-secret", secrets)).toBe("secret=[secret]");
    expect(redact("tokens example-refresh-one, example-refresh-two", secrets)).toBe(
      "tokens [secret], [secret]",
    );
    // The addresses aren't secrets: the log names the mailbox that failed.
    expect(redact("outreach@example.com refused", secrets)).toBe("outreach@example.com refused");
  });

  it("blanks both AWS keys", () => {
    const secrets = secretsOf({
      secrets: {
        ...noUrls,
        aws: { accessKeyId: "AKIAEXAMPLENOTREAL01", secretAccessKey: "example/aws+secret/key" },
      },
    });

    expect(redact("signed with AKIAEXAMPLENOTREAL01", secrets)).toBe("signed with [secret]");
    expect(redact("key example/aws+secret/key", secrets)).toBe("key [secret]");
  });

  it("blanks every API id a gateways.destroy job names", () => {
    const secrets = secretsOf({
      secrets: noUrls,
      job: {
        kind: "gateways.destroy",
        gateways: [
          { region: "us-east-1", apiId: "abc123def4" },
          { region: "eu-west-2", apiId: "zyx987wvu6" },
        ],
      },
    });

    expect(redact("deleted abc123def4 and zyx987wvu6 in us-east-1", secrets)).toBe(
      "deleted [secret] and [secret] in us-east-1",
    );
    expect(secretsOf({ secrets: noUrls, job: { kind: "gateways.test" } })).toEqual([]);
  });
});
