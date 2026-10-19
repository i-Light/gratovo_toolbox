import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSecretStore, type Cipher } from "./secret-store";

const marker = "FAKE:";

function fakeCipher(): Cipher & { available: boolean; failDecrypt: boolean } {
  const cipher = {
    available: true,
    failDecrypt: false,
    isAvailable: () => cipher.available,
    encrypt: (plainText: string) =>
      Buffer.concat([Buffer.from(marker), Buffer.from(plainText, "utf8").reverse()]),
    decrypt: (cipherText: Buffer) => {
      if (cipher.failDecrypt || !cipherText.toString("utf8").startsWith(marker)) {
        throw new Error("wrong key");
      }
      return Buffer.from(cipherText.subarray(marker.length)).reverse().toString("utf8");
    },
  };
  return cipher;
}

let folder: string;
let file: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-secrets-"));
  file = join(folder, "nested", "secrets.json");
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("createSecretStore", () => {
  it("returns what was set", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("gemini.api-key", "sk-test-000");
    expect(await store.get("gemini.api-key")).toBe("sk-test-000");
  });

  it("round-trips unicode values", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("unicode", "sk-test-é漢字🙂");
    expect(await store.get("unicode")).toBe("sk-test-é漢字🙂");
  });

  it("replaces a value that is set again", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("token", "sk-test-000");
    await store.set("token", "sk-test-111");
    expect(await store.get("token")).toBe("sk-test-111");
  });

  it("returns undefined for a secret that isn't set", async () => {
    const store = createSecretStore(file, fakeCipher());
    expect(await store.get("missing")).toBeUndefined();
  });

  it("reports which secrets are set, sorted, without values", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("zeta", "sk-test-000");
    await store.set("alpha", "sk-test-111");
    expect(await store.names()).toEqual(["alpha", "zeta"]);
    expect(await store.has("alpha")).toBe(true);
    expect(await store.has("beta")).toBe(false);
  });

  it("deletes a secret and says whether there was one", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("token", "sk-test-000");
    expect(await store.delete("token")).toBe(true);
    expect(await store.delete("token")).toBe(false);
    expect(await store.has("token")).toBe(false);
  });

  it("doesn't rewrite the file when deleting a secret that isn't set", async () => {
    const store = createSecretStore(file, fakeCipher());
    expect(await store.delete("token")).toBe(false);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never writes the plain value to disk", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("token", "sk-test-000");
    const text = await readFile(file, "utf8");
    expect(text).not.toContain("sk-test-000");
    expect(text).not.toContain("000-tset-ks");
  });

  it("stores the documented format", async () => {
    const cipher = fakeCipher();
    const store = createSecretStore(file, cipher);
    await store.set("token", "sk-test-000");
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    expect(parsed).toEqual({
      version: 1,
      secrets: { token: cipher.encrypt("sk-test-000").toString("base64") },
    });
  });

  it("leaves no temporary file behind", async () => {
    const store = createSecretStore(file, fakeCipher());
    await store.set("token", "sk-test-000");
    expect(await readdir(join(folder, "nested"))).toEqual(["secrets.json"]);
  });

  it("treats a missing file as an empty store", async () => {
    const store = createSecretStore(file, fakeCipher());
    expect(await store.names()).toEqual([]);
    expect(await store.has("token")).toBe(false);
    expect(await store.get("token")).toBeUndefined();
  });

  it("doesn't confuse names with inherited properties", async () => {
    const store = createSecretStore(file, fakeCipher());
    expect(await store.has("constructor")).toBe(false);
    expect(await store.has("tostring")).toBe(false);
    expect(await store.get("constructor")).toBeUndefined();
    await store.set("constructor", "sk-test-000");
    expect(await store.names()).toEqual(["constructor"]);
  });

  it("refuses invalid names", async () => {
    const store = createSecretStore(file, fakeCipher());
    for (const name of ["", "Gemini", "../x", "a b"]) {
      await expect(store.set(name, "sk-test-000")).rejects.toThrow(
        `Not a valid secret name: "${name}"`,
      );
      await expect(store.get(name)).rejects.toThrow("Not a valid secret name");
      await expect(store.has(name)).rejects.toThrow("Not a valid secret name");
      await expect(store.delete(name)).rejects.toThrow("Not a valid secret name");
    }
  });

  it("refuses empty and oversized values without echoing them", async () => {
    const store = createSecretStore(file, fakeCipher());
    await expect(store.set("token", "")).rejects.toThrow();
    const huge = "sk-test-" + "x".repeat(65536);
    const error = await store.set("token", huge).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("sk-test-");
    await store.set("token", "x".repeat(65536));
    expect(await store.has("token")).toBe(true);
  });

  it("refuses to save or read when secure storage is unavailable, and writes nothing", async () => {
    const cipher = fakeCipher();
    const store = createSecretStore(file, cipher);
    await store.set("token", "sk-test-000");
    cipher.available = false;
    await expect(store.get("token")).rejects.toThrow("Secure storage is not available");
    await expect(store.set("other", "sk-test-111")).rejects.toThrow(
      "Secure storage is not available",
    );
    expect(await store.names()).toEqual(["token"]);

    const fresh = createSecretStore(join(folder, "fresh.json"), cipher);
    await expect(fresh.set("token", "sk-test-000")).rejects.toThrow();
    await expect(readFile(join(folder, "fresh.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lets has, names and delete work without the cipher", async () => {
    const cipher = fakeCipher();
    const store = createSecretStore(file, cipher);
    await store.set("token", "sk-test-000");
    cipher.available = false;
    expect(await store.has("token")).toBe(true);
    expect(await store.names()).toEqual(["token"]);
    expect(await store.delete("token")).toBe(true);
  });

  it("says which secret couldn't be decrypted, without any value", async () => {
    const cipher = fakeCipher();
    const store = createSecretStore(file, cipher);
    await store.set("token", "sk-test-000");
    cipher.failDecrypt = true;
    const error = await store.get("token").catch((caught: unknown) => caught);
    expect((error as Error).message).toBe('The secret "token" could not be decrypted');
  });

  it("keeps every update from 20 concurrent sets", async () => {
    const store = createSecretStore(file, fakeCipher());
    const names = Array.from(
      { length: 20 },
      (_, index) => `key-${String.fromCharCode(97 + index)}`,
    );
    await Promise.all(names.map((name) => store.set(name, `sk-test-${name}`)));
    expect(await store.names()).toEqual([...names].sort());
    for (const name of names) {
      expect(await store.get(name)).toBe(`sk-test-${name}`);
    }
  });

  it("keeps working after an operation fails", async () => {
    const store = createSecretStore(file, fakeCipher());
    const failed = store.set("Bad Name", "sk-test-000");
    const worked = store.set("token", "sk-test-111");
    await expect(failed).rejects.toThrow();
    await worked;
    expect(await store.get("token")).toBe("sk-test-111");
  });

  describe("a damaged file", () => {
    const bodies = [
      "not json",
      "[]",
      '{"version":2,"secrets":{}}',
      '{"version":1,"secrets":{"token":"not base64!"}}',
      '{"version":1,"secrets":{},"extra":true}',
    ];

    it.each(bodies)("throws for every operation and stays unchanged: %s", async (body) => {
      const store = createSecretStore(file, fakeCipher());
      const other = createSecretStore(file, fakeCipher());
      await other.set("seed", "sk-test-000");
      await writeFile(file, body);

      await expect(store.names()).rejects.toThrow("The secrets file is damaged");
      await expect(store.has("token")).rejects.toThrow("The secrets file is damaged");
      await expect(store.get("token")).rejects.toThrow("The secrets file is damaged");
      await expect(store.set("token", "sk-test-111")).rejects.toThrow(
        "The secrets file is damaged",
      );
      await expect(store.delete("token")).rejects.toThrow("The secrets file is damaged");
      expect(await readFile(file, "utf8")).toBe(body);
    });
  });

  it("never puts a value in an error message", async () => {
    const cipher = fakeCipher();
    const store = createSecretStore(file, cipher);
    await store.set("token", "sk-test-000");
    const messages: string[] = [];
    const collect = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        messages.push((error as Error).message);
      }
    };
    cipher.failDecrypt = true;
    await collect(() => store.get("token"));
    cipher.failDecrypt = false;
    cipher.available = false;
    await collect(() => store.set("token", "sk-test-000"));
    cipher.available = true;
    await collect(() => store.set("Bad Name", "sk-test-000"));
    await writeFile(file, "damaged");
    await collect(() => store.set("token", "sk-test-000"));
    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(message).not.toContain("sk-test-000");
    }
  });
});
