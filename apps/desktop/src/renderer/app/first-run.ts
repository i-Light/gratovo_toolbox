import { useEffect } from "react";

import { appStore, go, selectRoute, setImportState, useApp } from "../lib/store";
import { loadConnections } from "../settings/connections/use-connections";

/** The first-run check runs once per app start; tests start it over. */
let started = false;

export function resetFirstRunForTests(): void {
  started = false;
}

/**
 * First run (D1): on live data, reads the Connections status once. When the old data has never been
 * brought in, the live gate learns it, and an app that opened on Find > Search with nothing visited
 * yet moves to Settings > Connections, where "Bring in old data" waits. Does nothing on example data.
 */
export function useFirstRun(): void {
  const source = useApp((s) => s.data.source);
  useEffect(() => {
    if (source !== "live" || started) {
      return;
    }
    started = true;
    void loadConnections().then((status) => {
      if (status === null) {
        // Not read: the next start of the frame tries again.
        started = false;
        return;
      }
      if (status.import.state !== "never") {
        setImportState("imported");
        return;
      }
      setImportState("never");
      const state = appStore().getState();
      const route = selectRoute(state);
      const firstLoad = state.ui.history.entries.length === 1;
      if (firstLoad && route.screen === "find" && route.tab === "search") {
        go("settings", "connections");
      }
    });
  }, [source]);
}
