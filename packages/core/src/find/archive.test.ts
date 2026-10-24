import { describe, expect, it } from "vitest";

import { archiveDate } from "./archive";

const day = 86_400_000;
const due = Date.UTC(2026, 9, 25, 12);
const rejected = Date.UTC(2026, 9, 18, 12);

describe("archiveDate", () => {
  it("moves the server's 7-day due date to the owner's archive days", () => {
    expect(archiveDate({ archiveDueAt: due, rejectedAt: rejected }, 7)).toBe(due);
    expect(archiveDate({ archiveDueAt: due, rejectedAt: rejected }, 14)).toBe(due + 7 * day);
    expect(archiveDate({ archiveDueAt: due, rejectedAt: null }, 3)).toBe(due - 4 * day);
  });

  it("counts from the reject when there is no due date", () => {
    expect(archiveDate({ archiveDueAt: null, rejectedAt: rejected }, 7)).toBe(rejected + 7 * day);
    expect(archiveDate({ archiveDueAt: null, rejectedAt: rejected }, 30)).toBe(rejected + 30 * day);
  });

  it("has no date with neither", () => {
    expect(archiveDate({ archiveDueAt: null, rejectedAt: null }, 7)).toBeNull();
    expect(archiveDate({ archiveDueAt: null, rejectedAt: null }, 21)).toBeNull();
  });
});
