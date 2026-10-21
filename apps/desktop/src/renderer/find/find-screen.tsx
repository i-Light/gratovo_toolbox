import { Btn, Empty, Icon, PageHead } from "@gratovo/ui";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { useAccount } from "../lib/account";
import { useFind } from "../lib/find";
import { screens } from "../lib/routes";
import { selectRoute, useApp } from "../lib/store";
import { strings } from "../strings";
import { Kept } from "./kept";
import { Keywords } from "./keywords";
import { LiveRun } from "./live-run";
import { Rules } from "./rules";

const text = strings.findSearch;

function SearchTab() {
  const { state, load, reload } = useFind();
  const account = useAccount();
  const info = screens.find;
  return (
    <div className="page">
      <PageHead title={info.name} {...(info.sub === null ? {} : { sub: info.sub })} />
      {state === null ? (
        load === "failed" ? (
          <div className="card">
            <Empty
              icon="alert"
              title={text.loadFailed}
              action={
                <Btn size="sm" onClick={reload}>
                  {text.retry}
                </Btn>
              }
            />
          </div>
        ) : null
      ) : (
        <>
          {account.signedIn ? null : (
            <p className="hint find-example">
              <Icon name="info" />
              {text.exampleData}
            </p>
          )}
          <div className="fd-grid">
            <Keywords state={state} />
            <div className="col">
              <LiveRun state={state} />
              <Rules rules={state.rules} />
              <Kept kept={state.kept} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The Find screen: the Search tab is built; the other tabs wait for their steps. */
export function FindScreen() {
  const tab = useApp((s) => selectRoute(s).tab);
  return tab === "search" ? <SearchTab /> : <PlaceholderScreen screen="find" />;
}
