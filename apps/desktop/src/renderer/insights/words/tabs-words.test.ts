import { alertKey } from "@gratovo/core/insights";
import type { Alert, Batch, Diagnosis, SummaryPart, Win } from "@gratovo/core/insights";
import { describe, expect, it } from "vitest";

import {
  allZero,
  emailsReport,
  everyAlert,
  fullAlerts,
  fullWins,
  funnelReport,
  funnelRows,
  now,
  overviewReport,
  r,
} from "../test-reports";
import {
  answerHeadline,
  batchesHeadline,
  batchesMeaning,
  diagnosisText,
  heroHeadline,
  heroMeaning,
  mailboxesHeadline,
  mailboxesMeaning,
  patternsHeadline,
  patternsMeaning,
  stepsHeadline,
  stepsMeaning,
  tryThis,
} from "./emails";
import {
  biggestDropSentence,
  cohortHeadline,
  daysHeadline,
  exitsHeadline,
  funnelHeadline,
} from "./funnel";
import { pct, ratioText } from "./format";
import {
  alertWords,
  attentionHeadline,
  fuelTile,
  pipelineHeadline,
  replyRateTile,
  signedTile,
  summaryText,
  waitingTile,
  winsHeadline,
  winWords,
} from "./overview";

describe("numbers", () => {
  it("shows a rate with its count", () => {
    expect(ratioText(r(9, 182))).toBe("4.9%, 9 of 182");
    expect(ratioText(r(0, 0))).toBe("none yet");
    expect(pct(0.1)).toBe("10%");
    expect(pct(0.08)).toBe("8.0%");
  });
});

describe("alert words", () => {
  it("words every alert kind with a title, why, numbers and a button", () => {
    expect(new Set(everyAlert.map((a) => a.kind)).size).toBe(15);
    for (const alert of everyAlert) {
      const w = alertWords(alert);
      expect(w.title, alert.kind).not.toBe("");
      expect(w.why, alert.kind).not.toBe("");
      expect(w.evidence, alert.kind).not.toBe("");
      expect(w.action, alert.kind).not.toBe("");
      expect(`${w.title}${w.evidence}`, alert.kind).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("puts the counts in the evidence", () => {
    const bounce: Alert = everyAlert[0] as Alert;
    expect(alertWords(bounce).evidence).toContain("4.9%, 3 of 61");
    expect(alertKey(bounce)).toBeTruthy();
  });

  it("chooses the headline from the marks", () => {
    expect(attentionHeadline([])).toBe("Nothing needs you right now.");
    expect(attentionHeadline(fullAlerts)).toBe("One thing needs you now, 7 to watch.");
    expect(attentionHeadline(fullAlerts.slice(1))).toBe("7 things are worth watching");
    expect(attentionHeadline(fullAlerts.slice(1, 2))).toBe("One thing is worth watching");
  });
});

describe("win words", () => {
  it("words every win kind", () => {
    const wins: Win[] = [
      ...fullWins.map((w) => w.win),
      { kind: "mailbox", mailbox: "outreach1@gratovo.co", replies: r(26, 420) },
    ];
    expect(new Set(wins.map((w) => w.kind)).size).toBe(4);
    for (const win of wins) {
      const w = winWords(win);
      expect(w.title).not.toBe("");
      expect(w.evidence).toMatch(/\d/);
      expect(w.todo).not.toBe("");
    }
    expect(winWords(fullWins[0]?.win as Win).evidence).toBe(
      "6.8%, 28 of 410 when a person edited the draft, 4.3%, 31 of 720 when sent as written.",
    );
  });

  it("chooses the headline from how many there are", () => {
    expect(winsHeadline([])).toBe("Nothing stands out yet.");
    expect(winsHeadline(fullWins.slice(0, 1))).toBe("One thing is working. Do more of it.");
    expect(winsHeadline(fullWins)).toBe("3 things are working. Do more of them.");
  });
});

describe("summary words", () => {
  const all: SummaryPart[] = [
    { kind: "sent", sent: 182, change: 6, onPace: true },
    { kind: "replies", replied: 9, rate: r(9, 182), signed: 1 },
    { kind: "needs", alerts: fullAlerts.slice(0, 1) },
  ];
  it("words every part", () => {
    expect(summaryText(all)).toBe(
      "You sent 182 emails, 6 more than the period before, and first emails are on pace for your goal. 9 replies came in (4.9%, 9 of 182). 1 signed. One thing needs you now: outreach3@gratovo.co is bouncing.",
    );
    expect(summaryText([{ kind: "quiet" }])).toBe("Nothing needs you right now.");
  });
  it("handles fewer, the same, behind pace, no pace, nobody signed and many things", () => {
    expect(summaryText([{ kind: "sent", sent: 1, change: -3, onPace: false }])).toBe(
      "You sent 1 email, 3 fewer than the period before, and first emails are behind pace for your goal.",
    );
    expect(summaryText([{ kind: "sent", sent: 5, change: 0, onPace: null }])).toBe(
      "You sent 5 emails, the same as the period before.",
    );
    expect(summaryText([{ kind: "replies", replied: 0, rate: r(0, 40), signed: 0 }])).toContain(
      "Nobody has signed yet.",
    );
    const text = summaryText([{ kind: "needs", alerts: fullAlerts.slice(1) }]);
    expect(text).toContain("7 things are worth watching");
    expect(text).toContain("and 5 more");
  });
});

describe("tiles", () => {
  const v = overviewReport.vitals;
  it("words the reply rate against the floor and the period before", () => {
    const w = replyRateTile(v.replyRate);
    expect(w.value).toBe("4.9%");
    expect(w.lines.join(" ")).toContain("Above your 4% floor");
    expect(w.lines.join(" ")).toContain("5.7%, 10 of 175 before: could be chance.");
  });
  it("says too early on signings with the count still needed", () => {
    expect(signedTile(v.signedPer1000).lines[0]).toBe("182 of 50 emails so far.");
    expect(signedTile(v.signedPer1000).value).toBe("5.5");
  });
  it("words fuel in days with its warning", () => {
    const w = fuelTile(v.fuel);
    expect(w.value).toBe("2.6");
    expect(w.unit).toBe("days");
    expect(w.lines.join(" ")).toContain("Under 3 days");
  });
  it("words replies waiting by how long the oldest has waited", () => {
    expect(waitingTile(v.repliesWaiting, now).lines[0]).toBe("The oldest has waited 3 days.");
    expect(waitingTile({ count: 0, oldestAt: null, verdict: "good" }, now).lines[0]).toBe(
      "Every reply has an answer.",
    );
  });
  it("words the pipeline headline by the furthest step reached", () => {
    expect(pipelineHeadline(overviewReport.pipeline)).toBe(
      "Of 162,400 channels found, 16 have signed.",
    );
    expect(pipelineHeadline(funnelRows({ ...allZero, found: 10 }))).toBe(
      "10 channels found so far.",
    );
  });
});

describe("funnel words", () => {
  it("says what the rules drop and names the biggest drop", () => {
    expect(funnelHeadline(funnelReport.everyone, "replied")).toBe(
      "Your rules drop 87% on purpose. After that, the biggest drop is from Emailed to Replied.",
    );
    expect(funnelHeadline(funnelReport.everyone, null)).toContain("Your rules drop 87%");
    expect(funnelHeadline(funnelRows(allZero).slice(0, 1), null)).toBe(
      "Not enough creators have moved through yet to name a drop.",
    );
  });
  it("counts the creators lost at the biggest drop", () => {
    expect(biggestDropSentence(funnelReport.everyone, "replied")).toBe(
      "Of the steps people control, the biggest drop is from Emailed to Replied: 1,106 of 1,202 creators did not make it.",
    );
    expect(biggestDropSentence(funnelReport.everyone, null)).toBe(
      "No step you control stands out yet.",
    );
  });
  it("picks the exits headline by rule", () => {
    expect(exitsHeadline(funnelReport.exits)).toBe(
      "The audience check fails most often on countries.".replace(
        "The audience check fails most often on countries.",
        "The most common reason for a no is “not now”.",
      ),
    );
    expect(exitsHeadline({ ...funnelReport.exits, saidNo: [{ kind: "money", count: 1 }] })).toBe(
      "The audience check fails most often on countries.",
    );
    expect(exitsHeadline({ ...funnelReport.exits, saidNo: [], audience: [] })).toBe(
      "Most channels dropped in triage are not about AI.",
    );
    expect(exitsHeadline({ ...funnelReport.exits, saidNo: [], audience: [], triage: [] })).toBe(
      "Nobody has dropped out yet.",
    );
  });
  it("names the longest wait and the cohort trend", () => {
    expect(daysHeadline(funnelReport.stepDays)).toBe(
      "Creators wait longest between Replied and Media kit in: 21 days.",
    );
    expect(daysHeadline([{ from: "found", to: "shortlisted", days: null }])).toBe(
      "Too early to say how long steps take.",
    );
    expect(cohortHeadline("clear")).toContain("clearly worse");
    expect(cohortHeadline("chance")).toContain("could be chance");
    expect(cohortHeadline("early")).toContain("Too early");
  });
});

describe("emails words", () => {
  it("words the hero from the numbers", () => {
    expect(heroHeadline(emailsReport)).toBe("726 emails in 30 days brought 35 replies, 4.8%.");
    expect(heroMeaning(emailsReport)).toBe(
      "Above your 4% floor. Weekends are quiet on purpose. Period before: 5.7%, 40 of 700.",
    );
    expect(heroMeaning({ ...emailsReport, rate: r(1, 20), rateVerdict: "early" })).toContain(
      "Too early to judge: 20 of 50 emails so far.",
    );
    expect(heroMeaning({ ...emailsReport, rate: r(10, 726), rateBefore: r(0, 0) })).toBe(
      "Below your 4% floor. The batches below say which problem it is.",
    );
  });
  it("chooses the steps headline and footer", () => {
    expect(stepsHeadline(emailsReport.bySteps)).toBe(
      "Follow-ups bring more than half of all replies.",
    );
    expect(
      stepsHeadline([
        { step: 0, rate: r(59, 1130), share: r(59, 80) },
        { step: 1, rate: r(21, 820), share: r(21, 80) },
      ]),
    ).toBe("The first email brings 74% of all replies.");
    expect(stepsHeadline([])).toBe("No replies in the last 90 days to split yet.");
    expect(stepsMeaning(emailsReport.bySteps)).toBe(
      "Follow-up 2 does as well as the first email. Keep it.",
    );
    expect(stepsMeaning(emailsReport.bySteps.slice(0, 2).concat())).toContain("fewer replies");
  });
  it("words every diagnosis and the batches headline", () => {
    const base = emailsReport.batches[0] as Batch;
    const kinds: Diagnosis[] = ["early", "delivery", "writing", "targeting", "healthy"];
    for (const diagnosis of kinds) {
      const text = diagnosisText({ ...base, diagnosis });
      expect(text, diagnosis).not.toBe("");
    }
    expect(diagnosisText({ ...base, diagnosis: "delivery" })).toBe(
      "Emails aren’t arriving. 3 bounced, mostly from outreach3@gratovo.co.",
    );
    expect(diagnosisText({ ...base, diagnosis: "delivery", bounceMailbox: null })).toBe(
      "Emails aren’t arriving. 3 bounced.",
    );
    expect(diagnosisText({ ...base, diagnosis: "early", sent: 31 })).toBe("31 of 50 sent");
    expect(batchesHeadline(emailsReport.batches)).toBe(
      "Batch #22 has a delivery problem, batch #21 a writing problem.",
    );
    expect(batchesHeadline([{ ...base, diagnosis: "targeting" }])).toBe(
      "Batch #22 has a targeting problem.",
    );
    expect(batchesHeadline([{ ...base, diagnosis: "healthy" }])).toBe(
      "Your recent batches look healthy.",
    );
    expect(batchesHeadline([{ ...base, diagnosis: "early" }])).toContain("Too early");
    expect(batchesHeadline([])).toBe("No batches yet.");
    expect(batchesMeaning(emailsReport.batches)).toBe(
      "The bounces in #22 come from outreach3@gratovo.co, so fix that first.",
    );
  });
  it("words the patterns: clear ones get Try this, others do not", () => {
    const [edited, weekday] = emailsReport.patterns;
    expect(patternsHeadline(emailsReport.patterns)).toBe(
      "Edited emails makes a clear difference to replies.",
    );
    expect(patternsHeadline([])).toBe("Nothing clearly changes the reply rate yet.");
    expect(tryThis(edited as (typeof emailsReport.patterns)[number])).toBe(
      "Try this: edit the opening line of each draft before it goes.",
    );
    expect(tryThis(weekday as (typeof emailsReport.patterns)[number])).toBeNull();
    expect(patternsMeaning([weekday as (typeof emailsReport.patterns)[number]])).toContain(
      "too few emails",
    );
    for (const kind of ["rewrite", "size", "country", "keyword", "weekday", "hour"] as const) {
      const text = tryThis({
        kind,
        groups: [{ key: "x", rate: r(1, 10) }],
        result: "clear",
        best: "x",
      });
      expect(text, kind).toContain("Try this: ");
    }
  });
  it("words how fast we answer and the mailboxes", () => {
    expect(answerHeadline(emailsReport.answer)).toBe("We answer in about 5.2 hours.");
    expect(answerHeadline({ medianHours: null, overDay: 0, verdict: "early" })).toBe(
      "Too early to tell how fast we answer.",
    );
    expect(mailboxesHeadline(emailsReport)).toBe(
      "outreach3@gratovo.co is bouncing. Your mailboxes used 52% of their room.",
    );
    expect(mailboxesMeaning(emailsReport.mailboxes)).toBe(
      "outreach1@gratovo.co has room for about 11 more a day.",
    );
  });
});
