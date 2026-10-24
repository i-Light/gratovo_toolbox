import { describe, expect, it } from "vitest";

import { emailConfidence, sortFoundEmails } from "./email";
import type { FoundEmail } from "./types";

const base = { email: "hello@modeldaily.ai", source: "about", videos: 0, business: false } as const;

describe("emailConfidence", () => {
  it("scores the About text, with and without a business word", () => {
    expect(emailConfidence(base)).toBe(0.9);
    expect(emailConfidence({ ...base, business: true })).toBe(0.95);
  });

  it("scores video descriptions by how many videos hold it", () => {
    const video = { ...base, source: "video" } as const;
    expect(emailConfidence({ ...video, videos: 1 })).toBe(0.6);
    expect(emailConfidence({ ...video, videos: 2 })).toBe(0.6);
    expect(emailConfidence({ ...video, videos: 3 })).toBe(0.8);
    expect(emailConfidence({ ...video, videos: 9 })).toBe(0.8);
  });

  it("ignores the business word for video addresses", () => {
    expect(emailConfidence({ ...base, source: "video", videos: 1, business: true })).toBe(0.6);
  });

  it("takes 0.05 off every free-mail domain, in any case", () => {
    for (const domain of [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "protonmail.com",
      "GMAIL.COM",
    ]) {
      expect(emailConfidence({ ...base, email: `a@${domain}` })).toBe(0.85);
    }
    expect(emailConfidence({ ...base, email: "a@gmail.com", business: true })).toBe(0.9);
    expect(emailConfidence({ ...base, email: "a@gmail.com", source: "video", videos: 1 })).toBe(
      0.55,
    );
  });

  it("does not treat a look-alike domain as free mail", () => {
    expect(emailConfidence({ ...base, email: "a@mygmail.com" })).toBe(0.9);
    expect(emailConfidence({ ...base, email: "a@gmail.com.ai" })).toBe(0.9);
  });
});

function found(email: string, source: "about" | "video", confidence: number): FoundEmail {
  return { email, source, videos: source === "video" ? 1 : 0, business: false, confidence };
}

describe("sortFoundEmails", () => {
  it("puts the most sure first, then About, then the address", () => {
    const list = [
      found("z@a.ai", "video", 0.9),
      found("b@a.ai", "about", 0.9),
      found("a@a.ai", "about", 0.9),
      found("c@a.ai", "video", 0.95),
      found("d@a.ai", "about", 0.6),
    ];
    expect(sortFoundEmails(list).map((f) => f.email)).toEqual([
      "c@a.ai",
      "a@a.ai",
      "b@a.ai",
      "z@a.ai",
      "d@a.ai",
    ]);
  });

  it("does not change the list it is given", () => {
    const list = [found("b@a.ai", "about", 0.6), found("a@a.ai", "about", 0.9)];
    sortFoundEmails(list);
    expect(list[0]?.email).toBe("b@a.ai");
  });
});
