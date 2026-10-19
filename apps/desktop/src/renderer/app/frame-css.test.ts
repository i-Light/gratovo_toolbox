import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("frame.css", () => {
  // No deviations: every rule is the prototype's, with the same selector and declarations.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./frame.css", import.meta.url));
  });
});
