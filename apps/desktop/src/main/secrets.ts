import { join } from "node:path";

import { app, safeStorage } from "electron";

import { createSecretStore, type Cipher, type SecretStore } from "./secret-store";

// On Windows, safeStorage encrypts with the signed-in account's key (DPAPI), so the file is
// useless to another account or on another machine.
const cipher: Cipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plainText) => safeStorage.encryptString(plainText),
  decrypt: (cipherText) => safeStorage.decryptString(cipherText),
};

/** The app's secret store, in its user data folder. Open it once the app is ready. */
export function openSecretStore(): SecretStore {
  return createSecretStore(join(app.getPath("userData"), "secrets.json"), cipher);
}
