import { Empty, PageHead } from "@gratovo/ui";

import { screens } from "../lib/routes";
import type { ScreenKey } from "../lib/routes";
import { strings } from "../strings";

/** Stands in for a screen that a later build step makes: its heading and a "still being built" note. */
export function PlaceholderScreen({ screen }: { readonly screen: ScreenKey }) {
  const info = screens[screen];
  return (
    <div className="page" data-ui={`${screen}.placeholder`}>
      <PageHead
        dataUi={`${screen}.placeholder.head`}
        title={info.name}
        {...(info.sub === null ? {} : { sub: info.sub })}
      />
      <div className="card" data-ui={`${screen}.placeholder.card`}>
        <Empty icon="wrench" title={strings.placeholder.title(info.name)}>
          {strings.placeholder.body}
        </Empty>
      </div>
    </div>
  );
}
