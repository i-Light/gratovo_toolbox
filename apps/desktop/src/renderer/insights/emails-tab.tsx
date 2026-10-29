import { Btn, Empty } from "@gratovo/ui";
import { rateOf, thresholds } from "@gratovo/core/insights";
import type { EmailsReport, InsightsGo, MailboxRow, PatternSplit } from "@gratovo/core/insights";

import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { BarList, ShareBar } from "./charts/bars";
import { LineChart } from "./charts/line-chart";
import { Panel } from "./panel";
import { DifferenceTag, VerdictDot } from "./verdict";
import {
  answerHeadline,
  batchesHeadline,
  batchesMeaning,
  diagnosisText,
  diagnosisVerdict,
  emailsIsEmpty,
  groupLabel,
  heroHeadline,
  heroMeaning,
  hoursText,
  isBouncing,
  isPositive,
  mailboxesHeadline,
  mailboxesMeaning,
  mailboxNote,
  patternsHeadline,
  patternsMeaning,
  readingLabel,
  readingsHeadline,
  readingsMeaning,
  stepLabel,
  stepsHeadline,
  stepsMeaning,
  tryThis,
} from "./words/emails";
import { dayLabel, num, ratioPct, ratioText } from "./words/format";
import "./tabs.css";

const t = strings.insights.emails;
const fmt = strings.insights.overview.fmt;
const dayMs = 86_400_000;

/** What `EmailsTab` takes. */
export interface EmailsTabProps {
  readonly report: EmailsReport;
  readonly onGo: (go: InsightsGo) => void;
}

const mailboxesGo: InsightsGo = { kind: "route", screen: "reach", tab: "mailboxes" };

function HeroPanel({ report }: { readonly report: EmailsReport }) {
  const daily = report.daily;
  const sent = daily.map((d) => ({ at: d.at, value: d.sent }));
  const replies = daily.map((d) => ({ at: d.at, value: d.replies }));
  const weekends = daily
    .map((d, i) => ({ d, next: daily[i + 1]?.at ?? d.at + dayMs }))
    .filter(({ d }) => [0, 6].includes(new Date(d.at).getDay()))
    .map(({ d, next }) => ({ from: d.at, to: next }));
  const last = daily.length - 1;
  const labels = daily
    .map((d, i) => ({ at: d.at, i }))
    .filter(({ i }) => i % 7 === 0 && last - i >= 3)
    .map(({ at }) => ({ at, label: dayLabel(at) }));
  const lastAt = daily[last]?.at;
  if (lastAt !== undefined) labels.push({ at: lastAt, label: t.hero.today });
  return (
    <Panel
      dataUi="insights.emails.hero"
      hero
      headline={heroHeadline(report)}
      counted={t.hero.counted}
      verdict={report.rateVerdict}
      what={t.hero.what}
      numbers={{
        columns: t.hero.columns,
        rows: daily.map((d) => [dayLabel(d.at), d.sent, d.replies]),
      }}
      meaning={heroMeaning(report)}
    >
      <div className="ins-chart">
        <p className="ins-chart-title">{t.hero.sentChart}</p>
        <LineChart
          points={sent}
          height={150}
          shaded={weekends}
          lastIsPartial
          yTickCount={3}
          ariaLabel={t.hero.sentChart}
        />
      </div>
      <div className="ins-chart">
        <p className="ins-chart-title">{t.hero.repliesChart}</p>
        <LineChart
          points={replies}
          height={120}
          tone="warn"
          shaded={weekends}
          lastIsPartial
          yTickCount={3}
          xLabels={labels}
          ariaLabel={t.hero.repliesChart}
        />
      </div>
    </Panel>
  );
}

function StepsPanel({ report }: { readonly report: EmailsReport }) {
  const rows = report.bySteps;
  return (
    <Panel
      dataUi="insights.emails.steps"
      headline={stepsHeadline(rows)}
      counted={t.steps.counted}
      what={t.steps.what}
      numbers={{
        columns: t.steps.columns,
        rows: rows.map((s) => [
          stepLabel(s.step),
          s.rate.d,
          s.rate.n,
          ratioPct(s.rate),
          ratioPct(s.share),
        ]),
      }}
      meaning={stepsMeaning(rows)}
    >
      <table className="ins-grid">
        <thead>
          <tr>
            <th scope="col">{t.steps.columns[0]}</th>
            <th scope="col" className="num">
              {t.steps.columns[1]}
            </th>
            <th scope="col" className="num">
              {t.steps.columns[2]}
            </th>
            <th scope="col" className="num">
              {t.steps.columns[3]}
            </th>
            <th scope="col">{t.steps.columns[4]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.step}>
              <td className="name">{stepLabel(s.step)}</td>
              <td className="num">{num(s.rate.d)}</td>
              <td className="num">{num(s.rate.n)}</td>
              <td className="num">{ratioPct(s.rate)}</td>
              <td className="bar">
                <div className="bar-cell">
                  <ShareBar n={s.share.n} d={s.share.d} ariaLabel={ratioText(s.share)} />
                  <span>{ratioPct(s.share)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ReadingsPanel({ report }: { readonly report: EmailsReport }) {
  return (
    <Panel
      dataUi="insights.emails.readings"
      headline={readingsHeadline(report.positive)}
      counted={t.readings.counted}
      what={t.readings.what}
      numbers={{
        columns: t.readings.columns,
        rows: report.readings.map((r) => [readingLabel(r.kind), r.count]),
      }}
      meaning={readingsMeaning(report.readings)}
    >
      <p className="ins-legend">
        <span>
          <i />
          {t.readings.wayForward}
        </span>
        <span>
          <i className="warn" />
          {t.readings.notNow}
        </span>
      </p>
      <BarList
        ariaLabel={t.readings.label}
        rows={report.readings.map((r) => ({
          key: r.kind,
          label: readingLabel(r.kind),
          value: r.count,
          display: num(r.count),
          tone: isPositive(r.kind) ? ("series-live" as const) : ("warn" as const),
        }))}
      />
    </Panel>
  );
}

function BatchesPanel({
  report,
  onGo,
}: {
  readonly report: EmailsReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const batches = report.batches;
  const range = (from: number, to: number): string => `${dayLabel(from)}–${dayLabel(to)}`;
  return (
    <Panel
      dataUi="insights.emails.batches"
      headline={batchesHeadline(batches)}
      counted={t.batches.counted}
      what={t.batches.what}
      numbers={{
        columns: t.batches.columns,
        rows: batches.map((b) => [
          `#${num(b.index)}`,
          range(b.from, b.to),
          b.sent,
          `${num(b.bounced)} of ${num(b.sent)}`,
          `${num(b.replied)} of ${num(b.sent)}`,
          b.positive,
          b.signed,
          diagnosisText(b),
        ]),
      }}
      meaning={batchesMeaning(batches)}
      actions={
        <Btn
          kind="ghost"
          size="sm"
          onClick={() => {
            onGo(mailboxesGo);
          }}
        >
          {t.batches.open}
        </Btn>
      }
    >
      <div className="ins-table-wrap">
        <table className="ins-grid">
          <thead>
            <tr>
              {t.batches.columns.map((c, i) => (
                <th key={c} scope="col" className={i >= 2 && i <= 6 ? "num" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.index} data-ui="insights.emails.batch">
                <td className="name">#{num(b.index)}</td>
                <td>{range(b.from, b.to)}</td>
                <td className="num">{num(b.sent)}</td>
                <td className={b.diagnosis === "delivery" ? "num hot" : "num"}>
                  {num(b.bounced)} of {num(b.sent)}
                </td>
                <td className="num">
                  {num(b.replied)} of {num(b.sent)}
                </td>
                <td className="num">{num(b.positive)}</td>
                <td className="num">{num(b.signed)}</td>
                <td>
                  <div className="ins-diagnosis">
                    <VerdictDot verdict={diagnosisVerdict(b)} />
                    <span>{diagnosisText(b)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Split({ split }: { readonly split: PatternSplit }) {
  const clear = split.result === "clear";
  const advice = tryThis(split);
  return (
    <div data-ui={`insights.emails.split.${split.kind}`}>
      <div className="ins-split-head">
        <span>{t.patterns.titles[split.kind]}</span>
        <DifferenceTag difference={split.result} />
      </div>
      <BarList
        ariaLabel={t.patterns.titles[split.kind]}
        tone="series-neutral"
        rows={split.groups.map((g) => ({
          key: g.key,
          label: groupLabel(split.kind, g.key),
          value: rateOf(g.rate) ?? 0,
          display: ratioText(g.rate),
          ...(clear && g.key === split.best ? { tone: "series-live" as const } : {}),
        }))}
      />
      {advice === null ? null : <p className="ins-also">{advice}</p>}
    </div>
  );
}

function PatternsPanel({ report }: { readonly report: EmailsReport }) {
  const patterns = report.patterns;
  return (
    <Panel
      dataUi="insights.emails.patterns"
      headline={patternsHeadline(patterns)}
      counted={t.patterns.counted}
      what={t.patterns.what}
      numbers={{
        columns: t.patterns.columns,
        rows: patterns.flatMap((p) =>
          p.groups.map((g) => [
            t.patterns.titles[p.kind],
            groupLabel(p.kind, g.key),
            ratioText(g.rate),
            strings.insights.difference[p.result],
          ]),
        ),
      }}
      meaning={patternsMeaning(patterns)}
    >
      {patterns.length === 0 ? null : (
        <div className="ins-splits">
          {patterns.map((p) => (
            <Split key={p.kind} split={p} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function AnswerPanel({
  report,
  onGo,
}: {
  readonly report: EmailsReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const a = report.answer;
  return (
    <Panel
      dataUi="insights.emails.answer"
      headline={answerHeadline(a)}
      counted={t.answer.counted}
      verdict={a.verdict}
      what={t.answer.what}
      numbers={{
        columns: t.answer.columns,
        rows: [
          [t.answer.median, a.medianHours === null ? fmt.dash : hoursText(a.medianHours)],
          [t.answer.overLabel, a.overDay],
        ],
      }}
      meaning={t.answer.meaning}
      actions={
        <Btn
          kind="ghost"
          size="sm"
          onClick={() => {
            onGo({ kind: "route", screen: "reach", tab: "inbox" });
          }}
        >
          {t.answer.open}
        </Btn>
      }
    >
      {a.medianHours === null ? null : (
        <div className="ins-answer">
          <BigNumber value={hoursText(a.medianHours)} unit={t.answer.unit} size="lg" />
          <p>{t.answer.over(num(a.overDay))}</p>
        </div>
      )}
    </Panel>
  );
}

function mailboxCells(row: MailboxRow): string[] {
  return [
    row.address,
    String(row.sent),
    ratioPct({ n: row.sent, d: row.room }),
    ratioText(row.bounced),
    ratioText(row.replies),
  ];
}

function MailboxesPanel({
  report,
  onGo,
}: {
  readonly report: EmailsReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const rows = report.mailboxes;
  const c = t.mailboxes.columns;
  const total = rows.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      room: acc.room + r.room,
      bn: acc.bn + r.bounced.n,
      bd: acc.bd + r.bounced.d,
      rn: acc.rn + r.replies.n,
      rd: acc.rd + r.replies.d,
    }),
    { sent: 0, room: 0, bn: 0, bd: 0, rn: 0, rd: 0 },
  );
  return (
    <Panel
      dataUi="insights.emails.mailboxes"
      headline={mailboxesHeadline(report)}
      counted={t.mailboxes.counted}
      what={t.mailboxes.what}
      numbers={{
        columns: c,
        rows: rows.map((r) => [...mailboxCells(r), strings.insights.verdict[r.verdict]]),
      }}
      meaning={mailboxesMeaning(rows)}
      actions={
        <Btn
          kind="pri"
          size="sm"
          onClick={() => {
            onGo(mailboxesGo);
          }}
        >
          {t.mailboxes.open}
        </Btn>
      }
    >
      <div className="ins-table-wrap">
        <table className="ins-grid">
          <thead>
            <tr>
              <th scope="col">{c[0]}</th>
              <th scope="col" className="num">
                {c[1]}
              </th>
              <th scope="col">{c[2]}</th>
              <th scope="col" className="num">
                {c[3]}
              </th>
              <th scope="col" className="num">
                {c[4]}
              </th>
              <th scope="col">{c[5]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const note = mailboxNote(r);
              const tooFew = r.replies.d < thresholds.minOther;
              return (
                <tr key={r.address} data-ui="insights.emails.mailbox">
                  <td className="name">
                    {r.address}
                    {note === null ? null : <small>{note}</small>}
                  </td>
                  <td className="num">{num(r.sent)}</td>
                  <td className="bar">
                    <div className="bar-cell">
                      <ShareBar
                        n={r.sent}
                        d={r.room}
                        ariaLabel={t.mailboxes.roomBar(
                          ratioPct({ n: r.sent, d: r.room }),
                          num(r.sent),
                          num(r.room),
                        )}
                      />
                      <span>{ratioPct({ n: r.sent, d: r.room })}</span>
                    </div>
                  </td>
                  <td className={isBouncing(r) ? "num hot" : "num"}>
                    {ratioPct(r.bounced)}
                    <small>
                      {num(r.bounced.n)} of {num(r.bounced.d)}
                    </small>
                  </td>
                  <td className="num">
                    {tooFew ? t.mailboxes.tooFew : ratioPct(r.replies)}
                    <small>
                      {num(r.replies.n)} of {num(r.replies.d)}
                    </small>
                  </td>
                  <td>
                    <VerdictDot verdict={r.verdict} />
                  </td>
                </tr>
              );
            })}
            <tr className="total">
              <td>{t.mailboxes.all}</td>
              <td className="num">{num(total.sent)}</td>
              <td>
                {t.mailboxes.roomOf(ratioPct({ n: total.sent, d: total.room }), num(total.room))}
              </td>
              <td className="num">
                {ratioPct({ n: total.bn, d: total.bd })}
                <small>
                  {num(total.bn)} of {num(total.bd)}
                </small>
              </td>
              <td className="num">
                {ratioPct({ n: total.rn, d: total.rd })}
                <small>
                  {num(total.rn)} of {num(total.rd)}
                </small>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** The Emails tab: are our emails arriving and working? (design 3.3). */
export function EmailsTab({ report, onGo }: EmailsTabProps) {
  if (emailsIsEmpty(report)) {
    return (
      <div className="card" data-ui="insights.emails.empty">
        <Empty icon="mail" title={t.empty.title}>
          {t.empty.body}
        </Empty>
      </div>
    );
  }
  return (
    <>
      <HeroPanel report={report} />
      <div className="ins-two">
        <StepsPanel report={report} />
        <ReadingsPanel report={report} />
      </div>
      <BatchesPanel report={report} onGo={onGo} />
      <div className="ins-two wide">
        <PatternsPanel report={report} />
        <AnswerPanel report={report} onGo={onGo} />
      </div>
      <MailboxesPanel report={report} onGo={onGo} />
    </>
  );
}
