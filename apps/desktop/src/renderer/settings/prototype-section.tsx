import { Btn, Icon, Switch, cx } from "@gratovo/ui";
import { scenarioKeys } from "@gratovo/ipc";

import {
  commentsForClaude,
  exportComments,
  openCount,
  pickScenario,
  setPanel,
  setPins,
  setPrototype,
  setShowDone,
  toggleCommenting,
  usePrototype,
} from "../lib/prototype";
import { appStore, findRecord, recordName } from "../lib/store";
import { toast } from "../lib/toast";
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
    const data = appStore().getState().data;
    const list = commentsForClaude(proto.comments, {
      refName: (ref) => {
        if (ref.kind !== "creator" && ref.kind !== "brand" && ref.kind !== "deal") {
          return null;
        }
        const found = { kind: ref.kind, id: ref.id } as const;
        return findRecord(data, found) === undefined ? null : recordName(data, found);
      },
    });
    const done = (): void => {
      toast({ msg: text.copied(open), icon: "copy", tone: "good", ms: 4000 });
    };
    const failed = (): void => {
      toast({ msg: text.copyFailed, icon: "alert", tone: "info" });
    };
    try {
      navigator.clipboard.writeText(list).then(done, failed);
    } catch {
      failed();
    }
  };

  const exportAll = (): void => {
    void exportComments().then((result) => {
      if (result?.ok === true) {
        toast({ msg: text.exportOk(result.count), icon: "check", tone: "good", ms: 4000 });
      } else if (result?.ok === false && result.problem === "no_repo") {
        toast({ msg: text.exportNoRepo, icon: "info", tone: "info" });
      } else {
        toast({ msg: text.exportFailed, icon: "alert", tone: "info" });
      }
    });
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
                <Btn size="sm" kind="ghost" icon="forward" onClick={exportAll}>
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
