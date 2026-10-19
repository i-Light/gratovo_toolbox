import { useLayoutEffect } from "react";

/**
 * For a panel that isn't a dialog (the peek, the trays): while `open` is true, remembers what had
 * focus when it opened, and gives focus back there when the panel closes and focus fell to the
 * page with it. A keyboard user who closes the panel with Esc carries on where they were; focus
 * the user moved elsewhere (a rail button that navigated, say) is left alone.
 */
export function useReturnFocus(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const opener = document.activeElement;
    return () => {
      // The panel's elements are gone by now, so focus that was inside it is on the body (or, in
      // some DOMs, still on the removed element).
      const focused = document.activeElement;
      const lost = focused === null || focused === document.body || !focused.isConnected;
      if (lost && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, [open]);
}
