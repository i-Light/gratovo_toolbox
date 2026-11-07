import { Kbd } from "@gratovo/ui";
import { Fragment } from "react";

import { goLetters, screenOrder, screens } from "../lib/routes";
import { useApp } from "../lib/store";
import { isScreenShown } from "../lib/wired";
import { strings } from "../strings";

/** The bar after G: "Jump to:" and each screen shown to this person with its letter. */
export function GoHint() {
  const armed = useApp((s) => s.ui.goArmed);
  const source = useApp((s) => s.data.source);
  if (!armed) {
    return null;
  }
  return (
    <div className="g-chord" role="status" data-ui="frame.go-hint">
      {strings.goHint.label}
      {screenOrder
        .filter((screen) => isScreenShown(screen, source))
        .map((screen) => {
          const letter = Object.keys(goLetters).find((l) => goLetters[l] === screen);
          return letter === undefined ? null : (
            <Fragment key={screen}>
              <Kbd>{letter.toUpperCase()}</Kbd> {screens[screen].name}
            </Fragment>
          );
        })}
    </div>
  );
}
