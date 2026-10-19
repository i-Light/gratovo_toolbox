/// Web/no-io build: only compiled-in values exist. There is no process
/// environment to fall back to, and no self-updating on web anyway.
String? githubEnvValue(String name) => null;
