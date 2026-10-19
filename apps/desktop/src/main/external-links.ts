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
