import type { FrameSource } from "@gratovo/core/data";
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
  return (
    <>
      {/* Always mounted and filled while armed, so a screen reader announces it. */}
      <div className="sr" role="status">
        {armed ? strings.goHint.label : ""}
      </div>
      {armed ? <Bar source={source} /> : null}
    </>
  );
}

function Bar({ source }: { readonly source: FrameSource }) {
  return (
    <div className="g-chord" aria-hidden="true" data-ui="frame.go-hint">
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
