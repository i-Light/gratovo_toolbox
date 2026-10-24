import type { CatalogItem } from "@gratovo/core/find";
import type { RejectReason } from "@gratovo/core/data";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { compareMax, compareMin } from "../lib/find-selection";
import { strings } from "../strings";
import { rejectReasons } from "./triage-card";

const text = strings.findGallery.bulk;

export interface BulkBarProps {
  /** The selected channels, with their stage as it is now. */
  readonly items: readonly CatalogItem[];
  readonly onShortlist: (items: readonly CatalogItem[]) => void;
  readonly onReject: (items: readonly CatalogItem[], reason: RejectReason) => void;
  readonly onCompare: () => void;
  readonly onClear: () => void;
}

/** The bar under the channels while some are selected (D21). Give to… waits for step T. */
export function BulkBar({ items, onShortlist, onReject, onCompare, onClear }: BulkBarProps) {
  const [reason, setReason] = useState<RejectReason>(rejectReasons[0] ?? "ai");
  const n = items.length;
  const shortlistable = items.filter((i) => i.stage === "new" || i.stage === "rejected");
  const rejectable = items.filter((i) => i.stage === "new" || i.stage === "shortlisted");
  const compareTip =
    n < compareMin ? text.compareFew : n > compareMax ? text.compareMany : text.compareTip;
  return (
    <div className="bulkbar" role="toolbar" aria-label={text.label}>
      <b>{text.selected(n)}</b>
      <Btn
        size="sm"
        kind="pri"
        icon="check"
        disabled={shortlistable.length === 0}
        tip={shortlistable.length > 0 ? text.shortlistTip : text.shortlistNone}
        onClick={() => {
          onShortlist(shortlistable);
        }}
      >
        {shortlistable.length > 0 && shortlistable.length !== n
          ? text.shortlistN(shortlistable.length)
          : text.shortlist}
      </Btn>
      <span className="btn-split">
        <Btn
          size="sm"
          icon="x"
          disabled={rejectable.length === 0}
          tip={rejectable.length > 0 ? text.rejectTip : text.rejectNone}
          onClick={() => {
            onReject(rejectable, reason);
          }}
        >
          {text.reject}
        </Btn>
        <select
          className="btn sm bulk-reason"
          value={reason}
          aria-label={text.rejectReason}
          onChange={(event) => {
            setReason(event.target.value as RejectReason);
          }}
        >
          {rejectReasons.map((r) => (
            <option key={r} value={r}>
              {strings.findActions.reasons[r]}
            </option>
          ))}
        </select>
      </span>
      <Btn
        size="sm"
        icon="compare"
        disabled={n < compareMin || n > compareMax}
        tip={compareTip}
        onClick={onCompare}
      >
        {text.compare}
      </Btn>
      <Btn size="sm" kind="ghost" tip={text.clearTip} kbd={strings.keys.esc} onClick={onClear}>
        {text.clear}
      </Btn>
    </div>
  );
}
