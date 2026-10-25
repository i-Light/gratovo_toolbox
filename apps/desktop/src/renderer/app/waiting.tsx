import type { AuthState } from "@gratovo/ipc";
import { useState } from "react";

import logoUrl from "../assets/logo.svg";
import { strings } from "../strings";

const text = strings.auth.waiting;

interface WaitingProps {
  readonly email: string | null;
  /** Asks main to look again; resolves to the new state, or null when the call failed. */
  readonly recheck: () => Promise<AuthState | null>;
  /** The state changed to something other than waiting. */
  readonly onChange: (state: AuthState) => void;
  readonly onSignOut: () => void;
}

/** Shown when the account is real but the owner hasn't given it access yet. */
export function Waiting({ email, recheck, onChange, onSignOut }: WaitingProps) {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    setChecking(true);
    setNote(null);
    const state = await recheck();
    if (state !== null && state !== "waiting") {
      onChange(state);
      return;
    }
    setNote(state === null ? text.checkFailed : text.stillWaiting);
    setChecking(false);
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-head">
          <span className="auth-brand">
            <img className="auth-logo" src={logoUrl} alt="" />
            {strings.brand.name}
          </span>
          <h1>{text.title}</h1>
          <p>{text.sub}</p>
          {email === null ? null : <p className="hint">{text.signedInAs(email)}</p>}
        </div>
        <p className="auth-problem quiet" role="status">
          {note ?? ""}
        </p>
        <div className="auth-actions">
          <button
            type="button"
            className="btn pri"
            disabled={checking}
            onClick={() => {
              void check();
            }}
          >
            {checking ? text.checking : text.check}
          </button>
          <button type="button" className="btn ghost" onClick={onSignOut}>
            {text.signOut}
          </button>
        </div>
      </div>
    </main>
  );
}
