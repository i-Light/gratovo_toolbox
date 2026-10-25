import { Tag } from "@gratovo/ui";

import { go, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { capacity } from "./reach-view";

const text = strings.reach.cap;

/**
 * Sends left today across the mailboxes that can send, with a meter. A button to the Mailboxes tab
 * when that tab is shown; plain text while it is not (live data, before 6b).
 */
export function CapSummary() {
  const mailboxes = useApp((s) => s.data.reach.mailboxes);
  const source = useApp((s) => s.data.source);
  const linked = shownTabs("reach", source).some((t) => t.key === "mailboxes");
  const cap = capacity(mailboxes);
  const tone = cap.left <= 5 ? "crit" : cap.left <= 15 ? "warn" : "";
  const share = cap.cap === 0 ? 0 : Math.min(100, (100 * cap.sent) / cap.cap);
  const body = (
    <>
      <span className="col t2" style={{ gap: 0 }}>
        <b className="num">{cap.left}</b>
        <small>{text.left}</small>
      </span>
      <span className="col tight" style={{ gap: "4px" }}>
        <span
          className={`meter ${tone}`}
          style={{ width: 120 }}
          role="meter"
          aria-label={text.meter}
          aria-valuemin={0}
          aria-valuemax={Math.max(cap.cap, 1)}
          aria-valuenow={cap.sent}
        >
          <i style={{ width: `${String(share)}%` }}></i>
        </span>
        <small className="num">{text.used(cap.sent, cap.cap, cap.live)}</small>
      </span>
      {cap.slowed > 0 ? (
        <Tag tone="warn" icon="alert">
          {text.slowed(cap.slowed)}
        </Tag>
      ) : null}
      {cap.paused > 0 ? <Tag icon="pause">{text.paused(cap.paused)}</Tag> : null}
    </>
  );
  return linked ? (
    <button
      type="button"
      className="rc-cap"
      data-ui="reach.cap"
      onClick={() => {
        go("reach", "mailboxes");
      }}
    >
      {body}
    </button>
  ) : (
    <div className="rc-cap" data-ui="reach.cap">
      {body}
    </div>
  );
}
