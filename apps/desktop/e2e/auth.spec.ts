import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import { expect, test } from "./fixtures";

const { signIn, waiting } = strings.auth;

/** The live copy and the secrets file in a data folder. */
const liveCopy = (userData: string) => join(userData, "gratovo.db");
const secretsFile = (userData: string) => join(userData, "secrets.json");

const emailField = (page: Page) => page.getByLabel(signIn.email);
const passwordField = (page: Page) => page.getByLabel(signIn.password, { exact: true });
const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

async function fillAndSubmit(page: Page, email: string, password: string): Promise<void> {
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await page.getByRole("button", { name: signIn.submit, exact: true }).click();
}

async function readSecrets(userData: string): Promise<string> {
  return existsSync(secretsFile(userData)) ? readFile(secretsFile(userData), "utf8") : "";
}

test.describe("signing in against a fake Supabase", () => {
  test("a wrong password shows the message and clears the password", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await startSigned({ ready: "page" });

    // The sign-in card is the first thing: no frame, and the alert is there but empty.
    await expect(heading(page, signIn.title)).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeEmpty();
    await expect(page.getByText(signIn.noAccount)).toBeVisible();

    await fillAndSubmit(page, owner.email, "not-the-password");
    await expect(page.getByRole("alert")).toHaveText(signIn.problems.invalid);
    await expect(passwordField(page)).toHaveValue("");
    await expect(emailField(page)).toHaveValue(owner.email);
    await expect(passwordField(page)).toBeFocused();
    expect(supabase.issued).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("a member the owner has not let in waits, then gets in after Check again", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const newcomer = supabase.addUser({ email: "sam@example.com", role: "unauthorized" });
    const { page } = await startSigned({ ready: "page" });

    await fillAndSubmit(page, newcomer.email, newcomer.password);
    await expect(heading(page, waiting.title)).toBeVisible();
    await expect(page.getByText(waiting.sub)).toBeVisible();
    await expect(page.getByText(waiting.signedInAs(newcomer.email))).toBeVisible();
    await expect(rail(page)).toHaveCount(0);

    // Nothing has changed, so checking again says so.
    await page.getByRole("button", { name: waiting.check, exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(waiting.stillWaiting);

    // The owner lets them in; the next check opens the app.
    supabase.setRole(newcomer.id, "basic");
    await page.getByRole("button", { name: waiting.check, exact: true }).click();
    await expect(rail(page)).toBeVisible();
    await expect(heading(page, waiting.title)).toHaveCount(0);
    expect(signedErrors).toEqual([]);
  });

  test("a restart opens the app from the stored session, without the password", async ({
    supabase,
    startSigned,
    userData,
    signedErrors,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const first = await startSigned({ ready: "page" });
    await fillAndSubmit(first.page, owner.email, owner.password);
    await expect(rail(first.page)).toBeVisible();
    const refreshesBefore = supabase.count("POST", "/auth/v1/token?grant_type=refresh_token");

    // Starting again on the same folder: the frame opens at once, with one refresh to the server.
    const { page } = await startSigned();
    await expect(rail(page)).toBeVisible();
    await expect(passwordField(page)).toHaveCount(0);
    await expect
      .poll(() => supabase.count("POST", "/auth/v1/token?grant_type=refresh_token"))
      .toBe(refreshesBefore + 1);

    // The password went to the server once, on the sign-in request, and nowhere else: not in any
    // other request's address, headers or body.
    const carrying = supabase.requests.filter((request) =>
      `${request.path}\n${JSON.stringify(request.headers)}\n${request.body}`.includes(
        owner.password,
      ),
    );
    expect(carrying.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /auth/v1/token?grant_type=password",
    ]);

    // The secret on disk holds neither a token nor the password in clear.
    expect(existsSync(liveCopy(userData))).toBe(true);
    const secrets = await readSecrets(userData);
    expect(secrets).toContain("supabase.session");
    expect(supabase.issued.length).toBeGreaterThan(0);
    for (const clear of [...supabase.issued, owner.password]) {
      expect(secrets).not.toContain(clear);
    }
    expect(signedErrors).toEqual([]);
  });

  test("with the server down, a stored session still opens the local copy", async ({
    supabase,
    startSigned,
    userData,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const first = await startSigned({ ready: "page" });
    await fillAndSubmit(first.page, owner.email, owner.password);
    await expect(rail(first.page)).toBeVisible();

    await supabase.stop();
    const { page } = await startSigned();
    await expect(rail(page)).toBeVisible();
    await expect(passwordField(page)).toHaveCount(0);
    expect(existsSync(liveCopy(userData))).toBe(true);

    // The server is back: the same session is still good.
    await supabase.start();
    const again = await startSigned();
    await expect(rail(again.page)).toBeVisible();
  });

  test("when the server ends the session, the app goes back to sign-in and drops the copy", async ({
    supabase,
    startSigned,
    userData,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const first = await startSigned({ ready: "page" });
    await fillAndSubmit(first.page, owner.email, owner.password);
    await expect(rail(first.page)).toBeVisible();
    expect(existsSync(liveCopy(userData))).toBe(true);

    supabase.revokeSessions(owner.id);
    const { page } = await startSigned({ ready: "page" });
    await expect(heading(page, signIn.title)).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await expect.poll(() => existsSync(liveCopy(userData))).toBe(false);
    expect(await readSecrets(userData)).not.toContain("supabase.session");
  });

  test("signing out returns to sign-in and removes the copy and the session", async ({
    supabase,
    startSigned,
    userData,
    signedErrors,
  }) => {
    const owner = supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const { page } = await startSigned({ ready: "page" });
    await fillAndSubmit(page, owner.email, owner.password);
    await expect(rail(page)).toBeVisible();
    expect(existsSync(liveCopy(userData))).toBe(true);

    await page.locator("button.me").click();
    await page.getByRole("menuitem", { name: strings.auth.signOut }).click();

    await expect(heading(page, signIn.title)).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    expect(existsSync(liveCopy(userData))).toBe(false);
    expect(await readSecrets(userData)).not.toContain("supabase.session");
    expect(supabase.count("POST", "/auth/v1/logout?scope=local")).toBe(1);

    // A restart still lands on sign-in.
    const restarted = await startSigned({ ready: "page" });
    await expect(heading(restarted.page, signIn.title)).toBeVisible();
    expect(signedErrors).toEqual([]);
  });
});
