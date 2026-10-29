import { describe, expect, it } from "vitest";

import { strings } from "../../strings";
import { emptyOverview, overviewReport } from "../test-reports";
import { summaryDocument } from "./summary";

const t = strings.insights;

describe("summaryDocument", () => {
  it("has the heading, the sentences, five vital lines and the attention titles", () => {
    const text = summaryDocument(overviewReport, "30d");
    const lines = text.split("\n");
    expect(lines[0]).toContain(t.comparedWith["30d"]);
    expect(text).toContain("182 emails");
    for (const label of [
      t.overview.vitals.emails.label,
      t.overview.vitals.replyRate.label,
      t.overview.vitals.signed.label,
      t.overview.vitals.fuel.label,
      t.overview.vitals.waiting.label,
    ]) {
      expect(lines.some((l) => l.startsWith(`${label}: `))).toBe(true);
    }
    expect(text).toContain(`(${t.verdict[overviewReport.vitals.replyRate.verdict]})`);
    expect(text).toContain("- outreach3@gratovo.co is bouncing");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(overviewReport.attention.length);
  });

  it("says so when nothing needs attention", () => {
    const text = summaryDocument({ ...emptyOverview, attention: [] }, "7d");
    expect(text).toContain(t.summaryDoc.nothing);
    expect(text).toContain(t.comparedWith["7d"]);
  });
});
