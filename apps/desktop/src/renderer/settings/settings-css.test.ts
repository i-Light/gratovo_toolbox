import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("settings.css", () => {
  // Every rule is the prototype's, except the ones below.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./settings.css", import.meta.url), {
      ".set-err":
        "Step 4: the inline problem under a search-rules field. The prototype's rules form has none.",
      ".set-num": "Step 4: the width of a number field in the search rules.",
      ".set-rule": "Step 4: one writing rule's row (the prototype styles it inline).",
      ".set-rule-id": "Step 4: the writing rule's ID tag (the prototype styles it inline).",
      ".set-rule-level": "Step 4: the writing rule's level word.",
      ".tb-ic":
        "Not in the prototype's index.html <style>: the prototype adds it from js/more.js l.60 (W.css). Ported as it is there.",
    });
  });
});
