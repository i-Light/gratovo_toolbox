// A feature that links somewhere new adds its host here, and nowhere else.
const allowedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "mail.google.com",
]);

/** True for a link the app may open in the browser: https, no credentials, default port, an allowed host. */
export function isAllowedExternalLink(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  // URL lowercases the hostname, so the set only needs lowercase entries.
  const { protocol, username, password, port, hostname } = new URL(url);
  return (
    protocol === "https:" &&
    username === "" &&
    password === "" &&
    port === "" &&
    allowedHosts.has(hostname)
  );
}
