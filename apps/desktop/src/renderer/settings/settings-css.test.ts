import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("settings.css", () => {
  // Every rule is the prototype's, except the ones below.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./settings.css", import.meta.url), {
      ".tb-ic":
        "Not in the prototype's index.html <style>: the prototype adds it from js/more.js l.60 (W.css). Ported as it is there.",
    });
  });
});
