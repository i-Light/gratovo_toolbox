import { unknownLanguage } from "@gratovo/core/find";
import { Btn, Tag } from "@gratovo/ui";
import { useState } from "react";

import { languageName, languageNames } from "../../lib/language";
import { strings } from "../../strings";
import { Row } from "../row";
import type { Draft, Rules } from "./draft";
import { Problem } from "./problem";

const text = strings.settings.searchRules;
const rows = strings.settings.rows;
const common = strings.languages.common;
/** The most codes the rules take. */
const languagesMax = 20;

/** "Main language is one of": the picked languages as a tag, or chips to pick them while editing. */
export function LanguagesRow(props: {
  readonly draft: Draft | null;
  readonly rules: Rules;
  readonly set: (patch: Partial<Draft>) => void;
}) {
  const { draft, rules, set } = props;
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const picked = draft?.languages ?? [];
  // Codes already in the rules that the common list lacks stay visible and pickable.
  const list = [...common, ...rules.languages.filter((code) => !common.includes(code))];
  const toggle = (code: string): void => {
    if (picked.includes(code)) {
      setProblem(null);
      set({ languages: picked.filter((c) => c !== code) });
      return;
    }
    if (picked.length >= languagesMax) {
      setProblem(text.languagesTooMany);
      return;
    }
    setProblem(null);
    set({ languages: [...picked, code] });
  };
  const add = (): void => {
    const code = typed.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code) || code === unknownLanguage) {
      setProblem(text.languagesCode);
      return;
    }
    if (!picked.includes(code)) {
      if (picked.length >= languagesMax) {
        setProblem(text.languagesTooMany);
        return;
      }
      set({ languages: [...picked, code] });
    }
    setTyped("");
    setProblem(null);
  };
  const shown = [...list, ...picked.filter((code) => !list.includes(code))];
  return (
    <Row
      id="rulesLanguages"
      label={rows.rulesLanguages.label}
      scope="team"
      desc={rows.rulesLanguages.desc}
      ui="settings.search.languages"
    >
      {draft === null ? (
        <div className="fchips">
          <Tag icon="globe">
            {rules.languages.length > 0 ? languageNames(rules.languages) : text.languagesAny}
          </Tag>
        </div>
      ) : (
        <div className="col" style={{ gap: "10px", minWidth: 0 }}>
          <div className="fchips" role="group" aria-label={text.languagesGroup}>
            {shown.map((code) => (
              <button
                key={code}
                type="button"
                className="chip"
                aria-pressed={picked.includes(code)}
                onClick={() => {
                  toggle(code);
                }}
              >
                {languageName(code)}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: "8px" }}>
            <input
              className="inp"
              style={{ width: "96px" }}
              maxLength={2}
              value={typed}
              aria-label={text.languagesOther}
              placeholder={text.languagesPlaceholder}
              onChange={(event) => {
                setTyped(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Btn size="sm" onClick={add}>
              {text.languagesAdd}
            </Btn>
            {picked.length === 0 ? <span className="small muted">{text.languagesAny}</span> : null}
          </div>
          <Problem id="set-err-languages" message={problem ?? undefined} />
        </div>
      )}
    </Row>
  );
}
