import { Icon } from "@gratovo/ui";

import { openSetting } from "../lib/actions";
import { go, useApp } from "../lib/store";
import { isScreenShown } from "../lib/wired";
import { strings } from "../strings";

const text = strings.today.screen.first;

/** Shown when there are no creators and no deals yet: four steps, each opening the place to do it. */
export function FirstDay() {
  const source = useApp((s) => s.data.source);
  const steps: readonly {
    readonly title: string;
    readonly sub: string;
    readonly run: () => void;
  }[] = [
    {
      title: text.search,
      sub: text.searchSub,
      run: () => {
        openSetting("search");
      },
    },
    {
      title: text.start,
      sub: text.startSub,
      run: () => {
        go("find", "search");
      },
    },
    {
      title: text.mailbox,
      sub: text.mailboxSub,
      run: () => {
        go("reach", "mailboxes");
      },
    },
    ...(isScreenShown("team", source)
      ? [
          {
            title: text.team,
            sub: text.teamSub,
            run: () => {
              go("team");
            },
          },
        ]
      : []),
  ];
  return (
    <section className="card" data-ui="today.first" aria-label={text.title}>
      <div className="card-h">
        <h2>{text.title}</h2>
      </div>
      <p className="muted">{text.hint}</p>
      <ol className="tdy-steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <button type="button" className="li tdy-step" onClick={step.run}>
              <span className="tdy-n num">{i + 1}</span>
              <span className="lt">
                <b>{step.title}</b>
                <small>{step.sub}</small>
              </span>
              <Icon name="forward" size={14} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
