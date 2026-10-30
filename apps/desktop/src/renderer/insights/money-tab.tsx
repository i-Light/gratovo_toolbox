import { Empty, Icon } from "@gratovo/ui";
import type { Drill, InsightsGo, MoneyReport } from "@gratovo/core/insights";

import type { RecordRef } from "../lib/routes";
import { strings } from "../strings";
import {
  BasketPanel,
  MarginPanel,
  OwedPanel,
  PayoutsPanel,
  RevenuePanel,
  SizePanel,
} from "./money-parts";
import { RepeatPanel, RosterPanel, StepsPanel } from "./money-people";
import { moneyIsEmpty } from "./words/money";
import type { Names } from "./words/names";
import "./money.css";

const t = strings.insights.money;

/** What `MoneyTab` takes. */
export interface MoneyTabProps {
  readonly report: MoneyReport;
  /** Names of brands, creators and deals, from the frame. */
  readonly names: Names;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
  /** Opens a brand, deal or creator record. */
  readonly onOpen: (record: RecordRef) => void;
}

/** Money (money viewers only): is money coming in, and is it safe? (design 3.5). */
export function MoneyTab({ report, names, onGo, onDrill, onOpen }: MoneyTabProps) {
  const part = { report, names, onGo, onDrill, onOpen };
  return (
    <div className="money" data-ui="insights.money.tab">
      <p className="money-lock" data-ui="insights.money.lock">
        <Icon name="lock" size={14} />
        {t.lockNote}
      </p>
      {moneyIsEmpty(report) ? (
        <div className="card" data-ui="insights.money.empty">
          <Empty icon="dollar" title={t.empty.title}>
            {t.empty.body}
          </Empty>
        </div>
      ) : (
        <>
          <RevenuePanel report={report} />
          <div className="money-grid two">
            <OwedPanel {...part} />
            <PayoutsPanel {...part} />
          </div>
          <div className="money-grid three">
            <MarginPanel {...part} />
            <SizePanel report={report} />
            <BasketPanel {...part} />
          </div>
          <RosterPanel {...part} />
          <div className="money-grid wide">
            <StepsPanel report={report} onDrill={onDrill} />
            <RepeatPanel {...part} />
          </div>
        </>
      )}
    </div>
  );
}
