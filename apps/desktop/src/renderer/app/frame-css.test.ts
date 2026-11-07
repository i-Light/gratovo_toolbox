import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("frame.css", () => {
  // Every rule is the prototype's, except the one below.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./frame.css", import.meta.url), {
      ".g-chord":
        "The G hint bar sits at the bottom centre on a raised surface (plan X9), not the prototype's dark chip at the end.",
      ".logo":
        "The rail shows the Gratovo logo as an image (owner, 2026-10-25), not the prototype's gradient tile.",
    });
  });
});
