import { PageHead } from "@gratovo/ui";

import { screens } from "../lib/routes";

/** The Today screen. A stub for now: the queue, the day band and the work pane come with the next task. */
export function TodayScreen() {
  const info = screens.today;
  return (
    <section className="page" data-ui="today">
      <PageHead dataUi="today.head" title={info.name} />
    </section>
  );
}
