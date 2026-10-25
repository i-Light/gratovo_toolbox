import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import logoUrl from "../assets/logo.svg";
import { strings } from "../strings";

const text = strings.auth.signIn;

export type SignInProblem = keyof typeof text.problems;
export type SignInOutcome = "waiting" | "signed-in";
export type SignInAnswer =
  | { readonly ok: true; readonly state: SignInOutcome }
  | { readonly ok: false; readonly problem: SignInProblem };

interface SignInProps {
  /** Asks main to sign in. The password goes here and nowhere else. */
  readonly signIn: (email: string, password: string) => Promise<SignInAnswer>;
  readonly onDone: (state: SignInOutcome, email: string) => void;
}

/** The sign-in card: shown while nobody is signed in. */
export function SignIn({ signIn, onDone }: SignInProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [empty, setEmpty] = useState(true);
  // The password lives in the field only: read on submit, cleared after a failure, never in state.
  const password = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  // Changes kept from a signed-out session that never reached the server.
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    emailField.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    void window.gratovo.invoke("sync:status", {}).then(
      (result) => {
        if (live && result.ok) {
          setWaiting(result.value.pending);
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const field = password.current;
    const typed = email.trim();
    if (busy || field === null || typed === "" || field.value === "") {
      return;
    }
    setBusy(true);
    setProblem(null);
    const answer = await signIn(typed, field.value);
    field.value = "";
    if (answer.ok) {
      onDone(answer.state, typed);
      return;
    }
    setEmpty(true);
    setProblem(answer.problem);
    setBusy(false);
  };

  // After a failure the fields come back; the next thing to type is the password.
  useEffect(() => {
    if (problem !== null) {
      password.current?.focus();
    }
  }, [problem]);

  return (
    <main className="auth">
      <form
        className="auth-card"
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
      >
        <div className="auth-head">
          <span className="auth-brand">
            <img className="auth-logo" src={logoUrl} alt="" />
            {strings.brand.name}
          </span>
          <h1>{text.title}</h1>
          <p>{text.sub}</p>
        </div>
        <label className="field">
          {text.email}
          <input
            ref={emailField}
            className="inp"
            type="email"
            name="email"
            autoComplete="username"
            spellCheck={false}
            maxLength={254}
            value={email}
            readOnly={busy}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
            }}
          />
        </label>
        <label className="field">
          {text.password}
          <input
            ref={password}
            className="inp"
            type="password"
            name="password"
            autoComplete="current-password"
            maxLength={1024}
            readOnly={busy}
            onChange={(event) => {
              setEmpty(event.currentTarget.value === "");
            }}
          />
        </label>
        <p className="auth-problem" role="alert">
          {problem === null ? "" : text.problems[problem]}
        </p>
        <button
          type="submit"
          className="btn pri lg auth-submit"
          disabled={busy || empty || email.trim() === ""}
        >
          {busy ? text.submitting : text.submit}
        </button>
        {waiting > 0 ? <p className="hint auth-foot">{text.waitingChanges(waiting)}</p> : null}
        <p className="hint auth-foot">{text.noAccount}</p>
      </form>
    </main>
  );
}
