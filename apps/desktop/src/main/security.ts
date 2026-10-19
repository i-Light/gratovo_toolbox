import { shell, type Session, type WebContents } from "electron";

import { isAppPage } from "./app-page";
import { isAllowedExternalLink } from "./external-links";
import { appPageUrl } from "./window";

/** Opens an allowlisted link in the browser. Any other link is dropped. */
function openOutside(url: string): void {
  if (!isAllowedExternalLink(url)) {
    return;
  }
  // The URL isn't logged: links can carry personal details.
  shell.openExternal(url).catch((error: unknown) => {
    console.error("Could not open a link in the browser:", error);
  });
}

/**
 * Applied to every web contents the app creates. The app is one page: it opens no windows, embeds
 * no webviews and never navigates away. Allowlisted links open in the browser instead.
 */
export function guardWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });

  // A link or script moving the page.
  contents.on("will-navigate", (event) => {
    if (!isAppPage(event.url, appPageUrl)) {
      event.preventDefault();
      openOutside(event.url);
    }
  });

  // The same for every frame, and for redirects, which will-navigate doesn't see.
  contents.on("will-frame-navigate", (event) => {
    if (!isAppPage(event.url, appPageUrl)) {
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event) => {
    if (!isAppPage(event.url, appPageUrl)) {
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
