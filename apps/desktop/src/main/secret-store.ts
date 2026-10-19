import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { secretName } from "@gratovo/ipc";
import { z } from "zod";

/** Encrypts and decrypts with the operating system's key store: Electron safeStorage in the app, a fake in tests. */
export interface Cipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

/** Secrets kept encrypted on disk. Only the main process may hold one: no IPC channel returns a value. */
export interface SecretStore {
  /** The secret's value, or undefined when it isn't set. Main process only: no IPC channel returns it. */
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  /** True if there was a secret to delete. */
  delete(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  /** The names of the secrets that are set, sorted. Never their values. */
  names(): Promise<string[]>;
}

const maxValueLength = 65536;

const fileSchema = z.strictObject({
  version: z.literal(1),
  secrets: z.record(z.string(), z.base64()),
});

const damaged = "The secrets file is damaged";
const unavailable = "Secure storage is not available, so secrets can't be saved or read";

function checkName(name: string): void {
  if (!secretName.safeParse(name).success) {
    throw new Error(`Not a valid secret name: "${name}"`);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Opens the store kept in `file`. The file is only read or written when an operation runs. */
export function createSecretStore(file: string, cipher: Cipher): SecretStore {
  // One queue for every operation, so two writes can't read the same old file and lose one update.
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    // A failed operation must not break the queue for the next one.
    queue = result.catch(() => undefined);
    return result;
  }

  // A Map, so a name like "constructor" is never mistaken for an inherited property.
  async function load(): Promise<Map<string, string>> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) {
        return new Map();
      }
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(damaged);
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(damaged);
    }
    return new Map(Object.entries(parsed.data.secrets));
  }

  // Write a temporary file and rename it, so a crash never leaves a half-written secrets file.
  async function save(entries: Map<string, string>): Promise<void> {
    const body = JSON.stringify({ version: 1, secrets: Object.fromEntries(entries) });
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, body, { mode: 0o600 });
    await rename(temporary, file);
  }

  return {
    get(name) {
      return enqueue(async () => {
        checkName(name);
        if (!cipher.isAvailable()) {
          throw new Error(unavailable);
        }
        const stored = (await load()).get(name);
        if (stored === undefined) {
          return undefined;
        }
        try {
          return cipher.decrypt(Buffer.from(stored, "base64"));
        } catch {
          throw new Error(`The secret "${name}" could not be decrypted`);
        }
      });
    },

    set(name, value) {
      return enqueue(async () => {
        checkName(name);
        if (typeof value !== "string" || value.length === 0 || value.length > maxValueLength) {
          throw new Error(`A secret's value must be 1 to ${String(maxValueLength)} characters`);
        }
        if (!cipher.isAvailable()) {
          throw new Error(unavailable);
        }
        const entries = await load();
        entries.set(name, cipher.encrypt(value).toString("base64"));
        await save(entries);
      });
    },

    delete(name) {
      return enqueue(async () => {
        checkName(name);
        const entries = await load();
        if (!entries.delete(name)) {
          return false;
        }
        await save(entries);
        return true;
      });
    },

    has(name) {
      return enqueue(async () => {
        checkName(name);
        return (await load()).has(name);
      });
    },

    names() {
      return enqueue(async () => [...(await load()).keys()].sort());
    },
  };
}
