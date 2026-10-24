import type { ConnectionsStatus } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useRef, useState } from "react";

import { strings } from "../../strings";
import { Row } from "../row";
import { Line } from "./line";
import { Problem } from "./problem";
import { StateTag } from "./state-tag";
import { saveChange } from "./use-connections";

const text = strings.settings.connections;
const rows = strings.settings.rows;

const proxiesMax = 100;

/** Proxies: how many, and a form that replaces the whole list. The URLs never come back. */
export function ProxiesRow({ status }: { readonly status: ConnectionsStatus }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const urls = list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const tooMany = urls.length > proxiesMax;
  const spaced = urls.some((url) => /\s/.test(url));
  const send = (next: readonly string[], msg: string, sub?: string): void => {
    if (saving.current) {
      return;
    }
    saving.current = true;
    setBusy(true);
    void saveChange(
      { kind: "proxies.urls", urls: [...next] },
      { row: "connProxies", msg, ...(sub === undefined ? {} : { sub }) },
    ).then((ok) => {
      saving.current = false;
      setBusy(false);
      if (ok) {
        setList("");
        setOpen(false);
      }
    });
  };
  const count = status.proxies.count;
  return (
    <Row
      id="connProxies"
      label={rows.connProxies.label}
      scope="team"
      desc={rows.connProxies.desc}
      ui="settings.connections.proxies"
    >
      <Line
        actions={
          open ? null : (
            <span className="row" style={{ gap: "6px" }}>
              <Btn
                size="sm"
                onClick={() => {
                  setOpen(true);
                }}
              >
                {text.proxies.replace}
              </Btn>
              <Btn
                size="sm"
                kind="ghost"
                disabled={count === 0 || busy}
                onClick={() => {
                  send([], text.proxies.cleared);
                }}
              >
                {text.proxies.clear}
              </Btn>
            </span>
          )
        }
      >
        <StateTag tone={count > 0 ? "good" : undefined}>{text.proxies.count(count)}</StateTag>
      </Line>
      {open ? (
        <div className="col" style={{ gap: "8px", width: "100%" }}>
          <label className="field">
            {text.proxies.label}
            <textarea
              className="inp"
              rows={5}
              autoComplete="off"
              spellCheck={false}
              placeholder={text.proxies.placeholder}
              value={list}
              onChange={(event) => {
                setList(event.currentTarget.value);
              }}
            />
          </label>
          {tooMany ? <Problem>{text.proxies.tooMany}</Problem> : null}
          {spaced ? <Problem>{text.proxies.bad}</Problem> : null}
          <div className="row wrap">
            <Btn
              kind="pri"
              size="sm"
              icon="check"
              disabled={busy || urls.length === 0 || tooMany || spaced}
              onClick={() => {
                send(urls, text.proxies.saved(urls.length));
              }}
            >
              {text.proxies.save}
            </Btn>
            <Btn
              size="sm"
              kind="ghost"
              onClick={() => {
                setOpen(false);
                setList("");
              }}
            >
              {text.cancel}
            </Btn>
          </div>
        </div>
      ) : (
        <span className="hint">{text.proxies.hint}</span>
      )}
    </Row>
  );
}
