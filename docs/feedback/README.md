# Feedback

The owner's comments from prototype mode ([ADR 0019](../decisions/0019-prototype-mode-built.md)).

`comments.json` is written by the app: Settings › Prototype mode › Export for Claude, or the same button in the comment list. It holds every comment, the open ones first, each with its number, kind (fix, idea or question), text, the scenario it was written in, where it was left (`where`, from the screen and tab keys) and the part of the app it is pinned to (`anchor.ui`, a `data-ui` id).

A session reads it, makes the changes or answers in the plan, and tells the owner which numbers it handled. The owner marks them done in the app. The file is overwritten at each export, so don't edit it by hand.
