import { audienceRule, canSign, checkAudience, signingStages } from "@gratovo/core/close";
import type { AudienceKey, AudienceRow } from "@gratovo/core/close";
import type { Creator, CreatorKit } from "@gratovo/core/data";
import { Btn, Icon, Tag } from "@gratovo/ui";
import { useState } from "react";

import { askMissing, decline, parkForAudience, sign } from "../lib/close-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { rateWords } from "./rate-words";

const text = strings.close.audience;

/** The most countries the first row names. */
const topShown = 3;

function label(key: AudienceKey): string {
  switch (key) {
    case "top":
      return text.rows.top;
    case "age":
      return text.rows.age(audienceRule.minAge, audienceRule.maxAge);
    case "engagement":
      return text.rows.engagement(audienceRule.minEngagement);
    case "rate":
      return text.rows.rate;
  }
}

function detail(key: AudienceKey, kit: CreatorKit | null): string {
  if (key === "top") {
    const top = (kit?.countries ?? []).slice(0, topShown);
    return top.length === 0
      ? text.notReceived
      : top.map((c) => (c.share === null ? c.code : `${c.code} ${String(c.share)}%`)).join(" · ");
  }
  if (key === "age") {
    return kit?.ageBand ?? text.notReceived;
  }
  if (key === "engagement") {
    return kit?.engagement == null ? text.notReceived : `${String(kit.engagement)}%`;
  }
  return rateWords(kit) ?? text.notReceived;
}

function Row({ row, kit }: { row: AudienceRow; kit: CreatorKit | null }) {
  const tone = row.ok === true ? "good" : row.ok === false ? "crit" : "unknown";
  return (
    <li className="ck" data-ui={`record.audience.row.${row.key}`} data-ok={tone}>
      <span className={`box ${tone}`}>
        <Icon name={row.ok === true ? "check" : row.ok === false ? "x" : "help"} />
      </span>
      <span className="t">
        {label(row.key)}
        <small>{detail(row.key, kit)}</small>
      </span>
    </li>
  );
}

/**
 * The four audience checks, and under them what to do about the verdict (plan step 8, D1): sign
 * when it passes, decline or park when it fails, ask when numbers are missing. The buttons show
 * only while the creator is in a stage the check can act on, and not at all with `actions` off.
 */
export function AudienceCheck({
  creator,
  actions = true,
}: {
  readonly creator: Creator;
  readonly actions?: boolean;
}) {
  const seesMoney = useApp((s) => s.data.seesMoney);
  const [busy, setBusy] = useState(false);
  const kit = creator.kit;
  const result = checkAudience(kit);
  const run = (job: () => Promise<boolean>): void => {
    setBusy(true);
    void job().finally(() => {
      setBusy(false);
    });
  };
  const here = actions && signingStages.includes(creator.stage);
  // Without money the rate can't be asked for or judged here: it is not a gap this person can fill.
  const askable = result.missing.some((key) => key !== "rate" || seesMoney);
  let buttons = null;
  if (here && result.verdict === "pass" && canSign(creator.stage, kit)) {
    buttons = (
      <>
        <Btn
          kind="pri"
          icon="pen"
          disabled={busy}
          onClick={() => {
            sign(creator.id);
          }}
        >
          <span data-ui="record.audience.sign">
            {kit?.rate == null ? text.signNoRate : text.sign(rateWords(kit) ?? "")}
          </span>
        </Btn>
        <span className="hint">{text.signHint}</span>
      </>
    );
  } else if (here && result.verdict === "fail") {
    buttons = (
      <>
        <Btn
          kind="pri"
          icon="mail"
          disabled={busy}
          onClick={() => {
            run(() => decline(creator.id));
          }}
        >
          <span data-ui="record.audience.decline">{text.decline}</span>
        </Btn>
        <Btn
          icon="alarm"
          disabled={busy}
          onClick={() => {
            run(() => parkForAudience(creator.id));
          }}
        >
          <span data-ui="record.audience.park">{text.park}</span>
        </Btn>
        <span className="hint">{text.failHint}</span>
      </>
    );
  } else if (here && result.verdict === "missing" && askable) {
    buttons = (
      <Btn
        icon="mail"
        disabled={busy}
        onClick={() => {
          run(() => askMissing(creator.id));
        }}
      >
        <span data-ui="record.audience.ask">{text.ask}</span>
      </Btn>
    );
  }
  return (
    <div
      className="col audience-check"
      data-ui="record.audience.check"
      role="group"
      aria-label={text.checkLabel}
    >
      <ul className="checks">
        {result.rows.map((row) => (
          <Row key={row.key} row={row} kit={kit} />
        ))}
      </ul>
      {kit?.fromReply === true ? (
        <div className="callout info" data-ui="record.audience.from-reply">
          <Icon name="info" />
          <span>{text.fromReply}</span>
        </div>
      ) : null}
      {/* The buttons say what the verdict means; without them, the verdict says it. */}
      {buttons === null ? (
        <span className="audience-verdict">
          <Tag
            tone={result.verdict === "pass" ? "good" : result.verdict === "fail" ? "crit" : "warn"}
          >
            {strings.close.next.verdict[result.verdict]}
          </Tag>
        </span>
      ) : (
        <div className="row wrap">{buttons}</div>
      )}
    </div>
  );
}
