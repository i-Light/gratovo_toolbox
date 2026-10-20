import { describe, it } from "vitest";

import { expectRulesMatchPrototype } from "@gratovo/ui/testing/prototype-styles";

describe("overlays.css", () => {
  // Every rule is the prototype's, except the ones below.
  it("matches the prototype rule for rule", () => {
    expectRulesMatchPrototype(new URL("./overlays.css", import.meta.url), {
      "dialog.layer":
        "E1: the native <dialog> wrapper is made invisible and full-screen, so the prototype's .scrim and .pal/.modal inside it look as before. The prototype has no dialog.",
      "dialog.layer::backdrop":
        "E1: the dialog's own backdrop is removed, because the prototype's .scrim already dims the page.",
      "dialog.layer:focus-visible":
        "E1: a dialog that takes focus itself (the shortcut sheet) is the invisible full-screen wrapper, so it shows no ring; its controls still do.",
      ".pal > .pal-in":
        "The 52 px search row keeps its height: in the prototype it shrank while the list was long, so the input jumped as typing shortened the list.",
      '.menu[role="menu"]':
        "Menus sit above the narrow-width drawer (z-index 86): in the prototype the account menu, opened from inside the drawer, showed under it.",
      ".menu .mwho small":
        "The role line sits under the name: in the prototype `.menu button small` (a shortcut hint's margin and padding) pushed it 14 px to the right.",
    });
  });
});
