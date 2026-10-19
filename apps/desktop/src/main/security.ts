import type { Session, WebContents } from "electron";

import { appPageUrl } from "./window";

/** True for the app's own page, whatever its #fragment. */
function isAppPage(url: string): boolean {
  try {
    const target = new URL(url);
    target.hash = "";
    return target.href === new URL(appPageUrl).href;
  } catch {
    return false;
  }
}

/**
 * Applied to every web contents the app creates. The app is one page: it opens no windows, embeds
 * no webviews and never navigates away. Links to the web will open in the browser through an
 * allowlist (step 3b).
 */
export function guardWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));

  contents.on("will-navigate", (event, url) => {
    if (!isAppPage(url)) {
      event.preventDefault();
    }
  });

  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

/** Camera, microphone, location, notifications and the rest: denied until a feature needs one. */
export function denyAllPermissions(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  target.setPermissionCheckHandler(() => false);
}
