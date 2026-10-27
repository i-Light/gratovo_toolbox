import { Btn, Icon, Switch, cx } from "@gratovo/ui";
import { scenarioKeys } from "@gratovo/ipc";

import {
  openCount,
  pickScenario,
  setPanel,
  setPins,
  setPrototype,
  setShowDone,
  toggleCommenting,
  usePrototype,
} from "../lib/prototype";
import { copyOpenForClaude, exportForClaude } from "../prototype/comment-actions";
import { strings } from "../strings";
import { Row } from "./row";

const text = strings.prototype;

/** The flow boxes and the three bullets that say what prototype mode is. */
function HowItWorks({ on }: { readonly on: boolean }) {
  const how = text.how;
  return (
    <div className="proto-how" data-ui="settings.prototype.how">
      <div className="ph-flow" aria-hidden="true">
        <span className="ph-box">
          {how.same}
          <small>{how.sameSub}</small>
        </span>
        <Icon name="arrowR" />
        <span className="ph-split">
          <span className={cx("ph-box", on ? undefined : "on")}>
            {how.live}
            <small>{on ? how.liveOn : how.liveOff}</small>
          </span>
          <span className={cx("ph-box", on ? "on" : undefined)}>
            {how.example}
            <small>{on ? how.exampleOn : how.exampleOff}</small>
          </span>
        </span>
      </div>
      <ul className="ph-list">
        {how.points.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Settings > Prototype mode: the switch, the scenario and the comment tool's controls. */
export function PrototypeSection() {
  const proto = usePrototype();
  const on = proto.status?.on === true;
  const scenario = proto.status?.scenario;
  const open = openCount(proto.comments);

  const copy = (): void => {
    copyOpenForClaude(proto.comments);
  };

  return (
    <>
      <HowItWorks on={on} />
      <Row
        id="proto"
        label={strings.settings.rows.proto.label}
        scope="you"
        desc={strings.settings.rows.proto.desc}
      >
        <div className="row">
          <Switch
            on={on}
            label={text.switchLabel}
            onChange={(next) => {
              void setPrototype(next);
            }}
          />
          <span className="small">{on ? text.on : text.off}</span>
        </div>
      </Row>
      {on ? (
        <>
          <Row
            id="scenario"
            label={strings.settings.rows.scenario.label}
            desc={strings.settings.rows.scenario.desc}
          >
            <div className="scn-grid">
              {scenarioKeys.map((key) => {
                const s = text.scenarios[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className="scn"
                    aria-pressed={scenario === key}
                    onClick={() => {
                      if (scenario !== key) {
                        void pickScenario(key);
                      }
                    }}
                  >
                    <span className="row" style={{ gap: "8px" }}>
                      <Icon name={s.icon} />
                      <b>{s.name}</b>
                    </span>
                    <small>{s.sub}</small>
                  </button>
                );
              })}
            </div>
          </Row>
          <Row
            id="comments"
            label={strings.settings.rows.comments.label}
            desc={strings.settings.rows.comments.desc}
          >
            <div className="col tight" style={{ gap: "10px", minWidth: 0 }}>
              <div className="row wrap">
                <Btn
                  size="sm"
                  kind="pri"
                  icon="chat"
                  onClick={() => {
                    toggleCommenting(true);
                  }}
                >
                  {text.startCommenting} <span className="kbd">{text.commentHint}</span>
                </Btn>
                <Btn
                  size="sm"
                  icon="list"
                  onClick={() => {
                    setPanel(true);
                  }}
                >
                  {text.allCommentsButton(open)}
                </Btn>
                <Btn size="sm" kind="ghost" icon="copy" disabled={open === 0} onClick={copy}>
                  {text.copyOpen}
                </Btn>
                <Btn size="sm" kind="ghost" icon="forward" onClick={exportForClaude}>
                  {text.exportAll}
                </Btn>
              </div>
              <div className="row" style={{ gap: "10px" }}>
                <Switch on={proto.pins} label={text.showPins} onChange={setPins} />
                <span className="small">{text.showPins}</span>
              </div>
              <div className="row" style={{ gap: "10px" }}>
                <Switch on={proto.showDone} label={text.showDone} onChange={setShowDone} />
                <span className="small">{text.showDone}</span>
              </div>
            </div>
          </Row>
        </>
      ) : null}
    </>
  );
}
