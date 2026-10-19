import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("overlays.css", () => {
  // Every rule is the prototype's, except the dialog wrapper rules below.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./overlays.css", import.meta.url), {
      "dialog.layer":
        "E1: the native <dialog> wrapper is made invisible and full-screen, so the prototype's .scrim and .pal/.modal inside it look as before. The prototype has no dialog.",
      "dialog.layer::backdrop":
        "E1: the dialog's own backdrop is removed, because the prototype's .scrim already dims the page.",
    });
  });
});
