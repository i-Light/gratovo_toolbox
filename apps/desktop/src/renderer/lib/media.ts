import { useSyncExternalStore } from "react";

/** Where the rail becomes a drawer: the prototype's small-screen rule (`app/frame.css`). */
export const narrowQuery = "(max-width: 760px)";

function subscribeNarrow(onChange: () => void): () => void {
  const list = matchMedia(narrowQuery);
  list.addEventListener("change", onChange);
  return () => {
    list.removeEventListener("change", onChange);
  };
}

/** True while the window is narrow enough that the rail is a drawer. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => matchMedia(narrowQuery).matches);
}
