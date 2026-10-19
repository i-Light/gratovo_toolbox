"""Every piece of configuration the pipeline reads, resolved in one place.

Four sources, in increasing order of precedence:

  1. built-in defaults here
  2. `data/settings.json`        — shared, committed, no secrets
  3. `data/settings.local.json`  — optional per-person override, gitignored
  4. `data/run_config.json`      — written by the app's Start button, one run only

Secrets and per-person identity live in `data/.env`, never in the settings
files. `data/.env.local` is read after it and wins: it is gitignored, so it is
where anything that must never reach the repository belongs — the Gmail refresh
token `tools/email_send.py --authorize --save` writes is put there for exactly
that reason.

Paths are resolved from THIS file's location outwards, so the pipeline works no
matter what the current working directory is. The previous version built paths
by string-concatenating `"\\\\.env"` onto a folder, which meant it ran correctly
only on Windows and only when launched from one specific directory.
"""

from __future__ import annotations

import json
import os
import socket
from pathlib import Path

# pipeline/gratovo/config.py -> pipeline/gratovo -> pipeline -> repo root
PACKAGE_DIR = Path(__file__).resolve().parent
PIPELINE_DIR = PACKAGE_DIR.parent
REPO_ROOT = PIPELINE_DIR.parent

DATA_DIR = Path(os.environ.get("GRATOVO_DATA_DIR") or (REPO_ROOT / "data"))
BACKEND_DIR = REPO_ROOT / "backend"

ENV_PATH = DATA_DIR / ".env"
LOCAL_ENV_PATH = DATA_DIR / ".env.local"
SETTINGS_PATH = DATA_DIR / "settings.json"
LOCAL_SETTINGS_PATH = DATA_DIR / "settings.local.json"
KEYWORDS_PATH = DATA_DIR / "keywords.json"
RUN_CONFIG_PATH = DATA_DIR / "run_config.json"
# Invoke URLs for the AWS API Gateway outbound-IP-rotation endpoints -- written
# by `tools/aws_gateway_setup.py`, read by `scrapetube._get_pool` alongside
# the http proxy list. Account-specific (embeds this AWS account's API ids),
# so unlike settings.json it is never committed -- see the .gitignore entry.
AWS_GATEWAYS_PATH = DATA_DIR / "aws_gateways.json"
# Touched by the app's "Try again now" button while a run is waiting out a
# YouTube backoff (`active_search_run_controller.dart`) and consumed
# (deleted) by `scrapetube._skip_wait_requested` the moment it is next
# checked -- a one-shot nudge, not a standing flag.
SKIP_WAIT_PATH = DATA_DIR / "skip_wait.signal"
# Every SQLite database this machine keeps, one level below `data/`.
#
# Split out because the two kinds of file in `data/` want opposite treatment.
# `.env`, `settings.json` and `keywords.json` are small, hand-edited and
# committed; the databases are large, machine-written and gitignored as a
# folder. Sharing one directory meant no gitignore rule could get the second
# group right without matching parts of the first, which is how a 100 MB
# `gratovo.db` came to be re-committed on every scrape.
#
# `ScraperProcessPaths.databaseDir` in the Flutter app resolves the same
# folder from the same `data/`, so both sides agree without either being told.
DATABASE_DIR = DATA_DIR / "database"

DB_PATH = DATABASE_DIR / "gratovo.db"
# Where `search.py --export-supabase` puts the one-time export of the tables
# that used to live in Supabase, and where `--bootstrap-r2` reads it from.
MIGRATION_DIR = DATA_DIR / "migration"
# The outreach send log — see gratovo/mailbox.py. A separate file from
# gratovo.db on purpose: nothing in it is shared, and nothing in it is a
# search result.
MAILBOX_DB_PATH = DATABASE_DIR / "mailbox.db"
# The Email Critique Library. Written by the Flutter app, read by
# tools/email_library.py — named here so neither side has to spell the path.
EMAIL_LIBRARY_DB_PATH = DATABASE_DIR / "email_library.db"
# Every Gmail mailbox connected on this machine -- see gratovo/gmail.py's doc
# comment. Gitignored like aws_gateways.json's sibling data/.env.local: each
# entry carries a live refresh token. A JSON list rather than more `.env.local`
# lines because a machine can now have several, and `KEY_1=`, `KEY_2=`... has
# no natural way to remove one from the middle without renumbering the rest.
GMAIL_ACCOUNTS_PATH = DATA_DIR / "gmail_accounts.local.json"

# The names that were in `data/` directly before the databases had a folder.
_LEGACY_DB_NAMES = ("gratovo.db", "mailbox.db", "email_library.db")


def ensure_database_dir():
    """Creates `data/database/` and moves anything left in the flat layout.

    Without the move this reorganisation is silently destructive on every
    machine that already has data: the new path is empty, so the next run
    creates a fresh `gratovo.db` and the person's real one sits in the old
    location, invisible to everything that looks for it. The Email Critique
    Library is worse again — nothing anywhere else holds a copy of it.

    Idempotent, cheap, and safe to call before every connection. A name that
    already exists at the new path is left alone, so an interrupted move
    finishes on the next call rather than clobbering what got through.

    The `-wal` and `-shm` siblings move with their database: a `-wal` holds
    committed rows not yet checkpointed into the main file, so moving the `.db`
    on its own can lose the most recent writes.

    Never raises. A read-only `GRATOVO_DATA_DIR`, or a database another process
    has open, leaves things exactly as they were — the caller's own `connect`
    reports that far more clearly than a failure here could.
    """
    try:
        DATABASE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    for name in _LEGACY_DB_NAMES:
        for suffix in ("", "-wal", "-shm"):
            source = DATA_DIR / f"{name}{suffix}"
            target = DATABASE_DIR / f"{name}{suffix}"
            if not source.exists() or target.exists():
                continue
            try:
                source.replace(target)
            except OSError as exc:
                print(f"[config] could not move {source.name} into "
                      f"{DATABASE_DIR}; leaving it where it is ({exc}).")


# Run at import, so every entry point — search.py, the tools, the app-launched
# process — gets the folder and the migration without each one remembering to
# ask. Guarded above, so an unwritable data folder is a no-op here and an
# honest error at the point something actually tries to open a database.
ensure_database_dir()

# channels().list / videos().list accept up to 50 comma-separated ids per call
BATCH_SIZE = 50


def load_env_file(path: Path) -> dict:
    """Minimal .env parser (KEY=VALUE, '#' comments, blanks ignored).

    Surrounding quotes are stripped, which the previous version did not do — a
    key pasted as "eyJ..." silently kept its quotes and failed to authenticate
    with an error that pointed nowhere near the cause.
    """
    values = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return values


def load_json_file(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except ValueError as exc:
        print(f"[config] {path.name} is not valid JSON ({exc}); ignoring it.")
        return default


def load_proxy_settings() -> dict:
    """The `proxies` key of settings.json (local override applied), read
    independently of the `Config` class.

    Nothing threads a `Config` instance into `scrapetube.py` today -- it
    only reaches config via the module-level `SKIP_WAIT_PATH` constant --
    so building a full `Config()` there just for one key would mean
    re-reading `.env` and `run_config.json` for nothing. This reads only
    what the proxy pool needs. Never raises: a missing or malformed key
    means "no proxies configured", not a crash.
    """
    settings = load_json_file(SETTINGS_PATH, {}) or {}
    local = load_json_file(LOCAL_SETTINGS_PATH)
    if local:
        settings.update(local)
    proxies = settings.get("proxies")
    return proxies if isinstance(proxies, dict) else {}


def _proxy_rotation_active(proxies_setting: dict) -> bool:
    """Whether settings.json's `proxies` key actually yields more than one
    outbound identity -- mirrors the candidate-building rules in
    `proxy_pool.ProxyPool.from_settings` (enabled, non-blank host, entry not
    individually disabled). `enabled: true` with an empty/all-disabled list
    is still "off" here: nothing would actually be rotated."""
    proxies_setting = proxies_setting or {}
    if not proxies_setting.get("enabled"):
        return False
    return any(
        isinstance(entry, dict)
        and entry.get("enabled", True)
        and str(entry.get("host") or "").strip()
        for entry in (proxies_setting.get("list") or [])
    )


def rotating_connection_count(proxies_setting: dict, gateway_urls) -> int:
    """How many outbound identities other than this machine's own the proxy
    pool will hold -- the usable proxies (when rotation is on) plus every AWS
    gateway. Same rules as `proxy_pool.ProxyPool.from_settings`, so the worker
    count and pacing decided here match the pool the run actually builds."""
    proxies_setting = proxies_setting or {}
    proxies = 0
    if proxies_setting.get("enabled"):
        proxies = sum(
            1 for entry in (proxies_setting.get("list") or [])
            if isinstance(entry, dict)
            and entry.get("enabled", True)
            and str(entry.get("host") or "").strip()
        )
    return proxies + len(gateway_urls or [])


def load_gmail_accounts() -> list:
    """Every Gmail mailbox connected on this machine, straight off disk.

    `[{"account": "a@b.com", "refreshToken": "...", "connectedAt": "..."}, ...]`.
    Never raises: a missing or malformed file just means no accounts. Callers
    that want the legacy single-token fallback folded in go through
    `Config.google_accounts` instead — this is the raw store, used by the
    tool's own read/modify/write cycle (`tools/email_send.py`'s
    `cmd_authorize` / `cmd_sign_out` / `_migrate_legacy_account`)."""
    data = load_json_file(GMAIL_ACCOUNTS_PATH, {}) or {}
    accounts = data.get("accounts")
    return [a for a in accounts if isinstance(a, dict)] if isinstance(accounts, list) else []


def save_gmail_accounts(accounts: list) -> None:
    """Overwrites the whole store with [accounts]. Always the full list --
    there is no per-entry update here, the same way `_write_env_values`
    rewrites a whole `.env.local` rather than patching one line in place."""
    GMAIL_ACCOUNTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    GMAIL_ACCOUNTS_PATH.write_text(
        json.dumps({"accounts": accounts}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_aws_gateways() -> list:
    """Invoke URLs of this account's API Gateway outbound-IP-rotation
    endpoints -- one per region `tools/aws_gateway_setup.py` deployed to.

    Lives in its own file rather than settings.json: it is written by a
    script rather than hand-edited, embeds AWS account-specific ids, and
    settings.json is rewritten wholesale by the Flutter Settings screen,
    which would silently drop a key that screen doesn't know about. `enabled`
    defaults to off, same reasoning as the http proxy list -- a stock
    checkout with the file absent behaves exactly as before this existed.
    Never raises: a missing or malformed file just means no gateways.
    """
    data = load_json_file(AWS_GATEWAYS_PATH, {}) or {}
    if not data.get("enabled"):
        return []
    urls = []
    for entry in data.get("gateways") or []:
        if isinstance(entry, str):
            url = entry.strip()
        elif isinstance(entry, dict):
            url = str(entry.get("url") or "").strip()
        else:
            url = ""
        if url:
            urls.append(url)
    return urls


class Config:
    """Resolved configuration for one invocation."""

    def __init__(self) -> None:
        # `data/.env` is the pipeline's own file. `backend/.env` belongs to the
        # importer and holds the same Supabase credentials, so it is read as a
        # fallback — one set of keys, either place, rather than asking someone
        # to paste the same value into two files and keep them in step.
        self.env = {
            **load_env_file(BACKEND_DIR / ".env"),
            **load_env_file(ENV_PATH),
            **load_env_file(LOCAL_ENV_PATH),
        }

        self.settings = load_json_file(SETTINGS_PATH, {}) or {}
        local = load_json_file(LOCAL_SETTINGS_PATH)
        if local:
            self.settings.update(local)

        self.run_config = load_json_file(RUN_CONFIG_PATH, {}) or {}

        # Normal/Fast pacing profiles (Settings -> Advanced / Search tuning's
        # two tabs) -- same shape, `normal_pacing` used unless this process
        # actually started with IP rotation on, decided once here rather than
        # re-checked on every `delay()` call: a run's rotation config doesn't
        # change mid-run any more than any other setting.json value does. See
        # `delay()`.
        normal_pacing = self.settings.get("normal_pacing")
        self._normal_pacing = normal_pacing if isinstance(normal_pacing, dict) else {}
        fast_pacing = self.settings.get("fast_pacing")
        self._fast_pacing = fast_pacing if isinstance(fast_pacing, dict) else {}
        proxies_setting = self.settings.get("proxies")
        self.rotating_connections = rotating_connection_count(
            proxies_setting if isinstance(proxies_setting, dict) else {},
            load_aws_gateways())
        # Parallel search (settings.json `parallel_search`, off by default):
        # one keyword per rotating connection at once. See `parallel.py`.
        from gratovo import parallel
        self.parallel_workers = parallel.worker_count(
            self.settings.get("parallel_search"), self.rotating_connections)
        # Fast only while rotation spreads ONE worker's requests over several
        # addresses. Several workers over the same addresses put each of them
        # back at about one worker's worth of traffic, so they keep the
        # Normal beat -- the owner's rule: parallel on means normal speed.
        self._pacing_is_fast = (
            self.rotating_connections > 0 and self.parallel_workers < 2)

    @property
    def pacing_profile(self) -> str:
        """"fast" or "normal" -- which of the two the delays come from."""
        return "fast" if self._pacing_is_fast else "normal"

    # ---- settings.json ----
    def setting(self, key, default=None):
        """settings.json stores `{"key": {"value": x}}` for scalars and
        `{"key": {"range": [lo, hi]}}` for delays; this reads the scalar form."""
        entry = self.settings.get(key)
        if isinstance(entry, dict) and "value" in entry:
            return entry["value"]
        return default

    def delay(self, key):
        """The raw `{"range": [lo, hi], "chance": n}` entry, for pacing.

        Reads from the `fast_pacing` profile instead of `normal_pacing` when
        IP rotation (a proxy list or an AWS Gateway) is actually active and
        the run is not parallel (see `__init__`) --
        see `search_tuning_card.dart`'s Normal/Fast tabs. Every request going
        out under a different apparent IP is the whole reason the fast
        profile is safe to use; without rotation this falls through to the
        normal profile exactly as before the two tabs existed. Falls back to
        the normal profile for any key the fast profile doesn't define, so a
        fast profile that only overrides some fields still works.

        `catchup_videos_delay` and `channel_sweep_break` aren't part of
        either profile -- they apply the same way regardless of Normal/Fast,
        so they live at the top level of `settings.json` and land here via
        the final fallback."""
        if self._pacing_is_fast:
            entry = self._fast_pacing.get(key)
            if entry:
                return entry
        return self._normal_pacing.get(key) or self.settings.get(key)

    # ---- credentials ----
    @property
    def youtube_api_key(self):
        return self.env.get("YOUTUBE_API_KEY")

    # ---- Cloudflare R2, where everything scraped is shared ----
    # Four values, all from data/.env. Missing any one of them means the
    # pipeline runs local-only and says so; nothing fails.
    @property
    def r2_account_id(self):
        return (self.env.get("R2_ACCOUNT_ID") or "").strip()

    @property
    def r2_access_key_id(self):
        return (self.env.get("R2_ACCESS_KEY_ID") or "").strip()

    @property
    def r2_secret_access_key(self):
        return (self.env.get("R2_SECRET_ACCESS_KEY") or "").strip()

    @property
    def r2_bucket(self):
        return (self.env.get("R2_BUCKET") or "").strip()

    @property
    def r2_configured(self):
        return bool(self.r2_account_id and self.r2_access_key_id
                    and self.r2_secret_access_key and self.r2_bucket)

    # ---- AWS (outbound IP rotation via API Gateway, tools/aws_gateway_setup.py) ----
    # Free-tier IAM user credentials, used only to provision/list/tear down the
    # API Gateway proxies -- never sent to YouTube and never used at request
    # time, since the deployed gateways themselves take no credentials to
    # invoke (see `aws_gateway_setup.py`'s doc comment on that trade-off).
    @property
    def aws_access_key_id(self):
        return (self.env.get("AWS_IAM_ACCESS_KEY_ID") or "").strip()

    @property
    def aws_secret_access_key(self):
        return (self.env.get("AWS_IAM_SECRET_ACCESS_KEY") or "").strip()

    @property
    def aws_configured(self):
        return bool(self.aws_access_key_id and self.aws_secret_access_key)

    # ---- Supabase ----
    # Only for the one-time `search.py --export-supabase` migration step. The
    # pipeline no longer writes anything to Supabase; the app does, as a
    # signed-in person.
    @property
    def supabase_url(self):
        return (self.env.get("SUPABASE_URL") or "").rstrip("/")

    @property
    def supabase_key(self):
        return (self.env.get("SUPABASE_SERVICE_KEY")
                or self.env.get("SUPABASE_SERVICE_ROLE_KEY") or "")

    # ---- the outreach mailbox (gratovo/gmail.py) ----
    # Read from data/.env.local by preference: unlike the YouTube key, a
    # refresh token is a live credential for a mailbox that sends mail as a
    # person, and data/.env is a tracked file.
    @property
    def google_client_id(self):
        return (self.env.get("GOOGLE_CLIENT_ID") or "").strip()

    @property
    def google_client_secret(self):
        return (self.env.get("GOOGLE_CLIENT_SECRET") or "").strip()

    @property
    def google_refresh_token(self):
        """The pre-multi-account single token, if `data/.env.local` still has
        one. Read only as a fallback inside `google_accounts` below -- once a
        mailbox connects through that fallback, `_migrate_legacy_account` in
        `tools/email_send.py` moves it into the real store and this goes back
        to reading nothing."""
        return (self.env.get("GOOGLE_REFRESH_TOKEN") or "").strip()

    @property
    def google_accounts(self):
        """Every Gmail mailbox connected on this machine.

        `[{"account": "a@b.com" | None, "refreshToken": "...", "connectedAt": "..." | None}, ...]`.
        Reads `data/gmail_accounts.local.json` (see `load_gmail_accounts`
        above); when that file has no entries yet AND a legacy single
        `GOOGLE_REFRESH_TOKEN` is set, returns a one-entry list for it with
        `"account": None` -- the email is not knowable without a live Gmail
        call, so it stays unresolved until something actually connects with
        it, at which point `tools/email_send.py`'s `_migrate_legacy_account`
        adopts it into the real store and this fallback stops firing.
        """
        accounts = load_gmail_accounts()
        if accounts:
            return accounts
        if self.google_refresh_token:
            return [{
                "account": None,
                "refreshToken": self.google_refresh_token,
                "connectedAt": None,
            }]
        return []

    @property
    def sender_name(self):
        """The display name outreach goes out under, e.g. "Moustafa at Gratovo".

        Only the name: the address is whatever the connected mailbox is, and
        Gmail overwrites any attempt to claim a different one."""
        return (self.env.get("OUTREACH_FROM_NAME") or "").strip()

    @property
    def outreach_label(self):
        """The Gmail label every sent outreach message is filed under.

        Outreach shares a personal inbox with everything else that inbox is
        for, and the label is what keeps "what has the pipeline sent" a filter
        rather than a memory exercise."""
        return ((self.env.get("OUTREACH_GMAIL_LABEL") or "").strip()
                or self.setting("outreach_gmail_label", "Gratovo Outreach"))

    @property
    def worker_id(self):
        """Who is claiming a keyword, when several people share the queue."""
        return self.env.get("WORKER_NAME") or socket.gethostname()

    # ---- effective run values (run_config overrides settings.json) ----
    @property
    def handles_limit(self):
        return self.run_config.get("handle_limit") or self.setting("handles_to_search_limit", 10)

    # ---- auto-clean gate (run_config.json -> "auto_clean", falling back to
    # settings.json/settings.local.json's own "auto_clean") ----
    # The standing "Auto-clean results" rule, forwarded from the Flutter app on
    # the Start button. The app also runs its own post-run Supabase sweep with
    # the same bounds; this half moves the *subscriber* decision earlier, into
    # the run itself, so a channel the rule would throw away never costs a video
    # scrape. Only the subscriber range is ever read out of it here -- the
    # rule's average-views and min-videos bounds need data this point in the
    # run does not have yet, and stay with the post-run sweep.
    #
    # `run_config.json` is written fresh by the app before every run and wins
    # when present. The fallback to `self.settings` (settings.json merged with
    # this machine's settings.local.json, see `Config.__init__`) covers
    # anything that starts a run without going through the app's Start button
    # -- a bare `python search.py` invocation, `tools/import_handles.py`, or a
    # `run_config.json` from before the app forwarded a rule at all.
    @property
    def _auto_clean(self):
        value = self.run_config.get("auto_clean")
        if not isinstance(value, dict):
            value = self.settings.get("auto_clean")
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _auto_clean_int(value):
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    @property
    def auto_clean_min_subscribers(self):
        return self._auto_clean_int(self._auto_clean.get("min_subscribers"))

    @property
    def auto_clean_max_subscribers(self):
        return self._auto_clean_int(self._auto_clean.get("max_subscribers"))

    @property
    def auto_clean_enabled(self):
        """On only when the app said so AND a subscriber bound is actually set --
        a range open at both ends is the caller having forgotten to pass one,
        and the gate does nothing rather than everything."""
        return bool(self._auto_clean.get("enabled")) and (
            self.auto_clean_min_subscribers is not None
            or self.auto_clean_max_subscribers is not None
        )

    def _auto_clean_action(self, key, default):
        """One band's verdict: 'sweep' (archive now, no videos), 'delay' (keep,
        fetch videos later via the backlog) or 'off' (treat as in range)."""
        action = str(self._auto_clean.get(key) or default).strip().lower()
        return action if action in ("sweep", "delay", "off") else default

    @property
    def auto_clean_below_min_action(self):
        return self._auto_clean_action("below_min_action", "sweep")

    @property
    def auto_clean_above_max_action(self):
        return self._auto_clean_action("above_max_action", "delay")

    @property
    def auto_clean_label(self):
        label = str(self._auto_clean.get("label") or "irrelevant").strip()
        return label if label in ("haramStuff", "irrelevant", "inactive") \
            else "irrelevant"

    @property
    def sort_by(self):
        return self.run_config.get("sort_by") or "relevance"

    @property
    def results_type(self):
        return self.run_config.get("results_type") or "video"

    @property
    def country_filter(self):
        """The set of ISO-3166 alpha-2 codes a run targets, or None for "any
        country" -- the same convention the app uses for an empty country
        picker. Reads the app's `countries` list; falls back to the legacy
        single `country` string so an older run config still works."""
        raw = self.run_config.get("countries")
        if raw is None:
            legacy = self.run_config.get("country")
            raw = [legacy] if legacy else []
        elif isinstance(raw, str):
            raw = [raw]
        codes = {str(c).strip().upper() for c in raw if str(c).strip()}
        return codes or None

    @property
    def backfill_batch_size(self):
        """How many backlog channels (missing their recent uploads, from any
        past run) get a turn after each keyword -- see
        `pipeline.backfill_missing_videos`. Bounded rather than exhaustive, so
        a large backlog is worked down a bit at a time instead of turning a
        keyword's worth of scraping into an unplanned hour."""
        return self.setting("backfill_batch_size", 25)

    def search_settings_snapshot(self):
        """Recorded against each keyword claim, so it is always possible to see
        what a given result set was actually collected with."""
        return {
            "handles_to_search_limit": self.handles_limit,
            "sort_by": self.sort_by,
            "results_type": self.results_type,
            "country": sorted(self.country_filter) if self.country_filter else None,
            "auto_clean": {
                "enabled": self.auto_clean_enabled,
                "min_subscribers": self.auto_clean_min_subscribers,
                "max_subscribers": self.auto_clean_max_subscribers,
                "below_min_action": self.auto_clean_below_min_action,
                "above_max_action": self.auto_clean_above_max_action,
                "label": self.auto_clean_label,
            } if self.auto_clean_enabled else None,
        }

    def describe(self):
        return (
            f"data dir      : {DATA_DIR}\n"
            f"database      : {DB_PATH}\n"
            f"youtube key   : {'set' if self.youtube_api_key else 'MISSING'}\n"
            f"r2 bucket     : {self.r2_bucket if self.r2_configured else 'not configured'}\n"
            f"mailbox       : {len(self.google_accounts)} account(s) connected\n"
            f"worker id     : {self.worker_id}"
        )


def load() -> Config:
    return Config()
