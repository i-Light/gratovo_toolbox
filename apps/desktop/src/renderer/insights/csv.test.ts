import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header and rows", () => {
    expect(
      toCsv(
        ["Step", "Count"],
        [
          ["Found", 12],
          ["Signed", 3],
        ],
      ),
    ).toBe("Step,Count\r\nFound,12\r\nSigned,3");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv(["a"], [["x, y"], ['say "hi"'], ["two\nlines"]])).toBe(
      'a\r\n"x, y"\r\n"say ""hi"""\r\n"two\nlines"',
    );
  });
});
