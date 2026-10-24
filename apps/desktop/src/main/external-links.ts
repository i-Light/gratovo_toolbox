// A feature that links somewhere new adds its host here, and nowhere else.
const allowedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "mail.google.com",
]);

/**
 * Gmail links may open a thread (named in the #fragment) and pick the account. Anything else, such
 * as `view=cm&to=…&body=…`, could let a script open a compose window filled in for the user.
 */
function isGmailThreadLink({ hostname, pathname, searchParams, hash }: URL): boolean {
  if (hostname !== "mail.google.com") {
    return true;
  }
  const keys = [...searchParams.keys()];
  return (
    pathname.startsWith("/mail/") &&
    keys.every((key) => key === "authuser") &&
    !hash.toLowerCase().includes("compose")
  );
}

/** True for a link the app may open in the browser: https, no credentials, default port, an allowed host. */
export function isAllowedExternalLink(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  // URL lowercases the hostname, so the set only needs lowercase entries.
  const link = new URL(url);
  return (
    link.protocol === "https:" &&
    link.username === "" &&
    link.password === "" &&
    link.port === "" &&
    allowedHosts.has(link.hostname) &&
    isGmailThreadLink(link)
  );
}

/**
 * True only for Google's consent page, which connecting a Gmail mailbox opens (plan D10): exactly
 * `https://accounts.google.com/o/oauth2/v2/auth?…`, no credentials, no port, no fragment. It is a
 * separate check that only the mailbox consent's opener uses, so `isAllowedExternalLink` (what
 * the page may open) stays as narrow as it was.
 */
export function isGoogleConsentUrl(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const link = new URL(url);
  return (
    link.protocol === "https:" &&
    link.username === "" &&
    link.password === "" &&
    link.port === "" &&
    link.hostname === "accounts.google.com" &&
    link.pathname === "/o/oauth2/v2/auth" &&
    link.search.length > 1 &&
    link.hash === ""
  );
}
