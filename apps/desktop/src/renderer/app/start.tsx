import type { AuthState } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { StrictMode } from "react";
import type { Root } from "react-dom/client";

import { setAccountView, signOut } from "../lib/account";
import { toAppData } from "../lib/frame";
import { installLiveUpdates } from "../lib/live";
import { installPersistence } from "../lib/persist";
import { routeFromHash } from "../lib/routes";
import { initAppStore, installHashSync } from "../lib/store";
import { strings } from "../strings";
import { App } from "./app";
import { SignIn, type SignInAnswer } from "./sign-in";
import { Waiting } from "./waiting";

const noAccount = { signedIn: false, email: null } as const;

/** The page starts here: ask main who is signed in, then show the sign-in card, the waiting screen or the app. */
export async function startApp(root: Root, invoke: Bridge["invoke"]): Promise<void> {
  let installed = false;
  // The page's way to hear from main; the test bridges that have none get no live updates.
  const on = (globalThis as { gratovo?: Partial<Bridge> }).gratovo?.on;

  const failed = (): void => {
    // The reason is logged in the main process; the page only says what to do.
    root.render(
      <main className="load-failed" role="alert">
        <h1>{strings.loadFailed.title}</h1>
        <p>{strings.loadFailed.sub}</p>
      </main>,
    );
  };

  const openApp = async (signedIn: boolean): Promise<void> => {
    const loaded = await invoke("frame:load", {});
    if (!loaded.ok) {
      failed();
      return;
    }
    initAppStore(toAppData(loaded.value), routeFromHash(location.hash));
    if (!installed) {
      installed = true;
      // From here on every change to the data is written back; what was just loaded counts as saved.
      installPersistence(invoke);
      installHashSync();
      if (signedIn && on !== undefined) {
        installLiveUpdates({ invoke, on });
      }
    }
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  };

  const signIn = async (email: string, password: string): Promise<SignInAnswer> => {
    const answer = await invoke("auth:sign-in", { email, password });
    return answer.ok ? answer.value : { ok: false, problem: "failed" };
  };

  const show = async (state: AuthState, email: string | null): Promise<void> => {
    if (state === "signed-out") {
      setAccountView(noAccount);
      root.render(
        <SignIn
          signIn={signIn}
          onDone={(next, who) => {
            void show(next, who);
          }}
        />,
      );
    } else if (state === "waiting") {
      setAccountView(noAccount);
      let who = email;
      root.render(
        <Waiting
          email={email}
          recheck={async () => {
            const checked = await invoke("auth:recheck", {});
            if (!checked.ok) {
              return null;
            }
            who = checked.value.email ?? who;
            return checked.value.state;
          }}
          onChange={(next) => {
            void show(next, who);
          }}
          onSignOut={() => {
            void signOut(invoke);
          }}
        />,
      );
    } else {
      setAccountView({ signedIn: state === "signed-in", email });
      await openApp(state === "signed-in");
    }
  };

  const status = await invoke("auth:status", {});
  if (!status.ok) {
    failed();
    return;
  }
  await show(status.value.state, status.value.email);
}
