/*
 * Gemini Bridge — browser compatibility shim. Loaded first in every context that uses the
 * extension APIs (service worker / background page, content scripts, popup).
 *
 * Firefox has two API namespaces: `browser.*` (promises) and `chrome.*` (callbacks in a
 * Manifest V2 extension). All of this code is written for the promise style that Chrome and Edge
 * give `chrome.*`, so on Firefox `chrome` is pointed at `browser`. Chrome and Edge have no
 * `browser` global, so there this file does nothing.
 *
 * Consequence for new code: on Firefox never pass a callback to a `chrome.*` API; use the promise.
 */
(function (root) {
  'use strict';
  try {
    if (typeof root.browser !== 'undefined' && root.browser && root.browser.runtime && root.browser.runtime.id) {
      root.chrome = root.browser;
    }
  } catch (_) { /* leave `chrome` as it is */ }
})(typeof globalThis !== 'undefined' ? globalThis : self);
