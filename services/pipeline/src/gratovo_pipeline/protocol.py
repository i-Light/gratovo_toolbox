"""The JSON-lines protocol with the desktop app (version 1, ADR 0013).

The source of truth is the zod schemas in `apps/desktop/src/main/pipeline/protocol.ts`; the
`protocol.schema.json` beside this file is generated from them, and the tests check every message
written here against it. The names below are the wire's, camelCase included.

Main writes one `start` line, then perhaps a `stop`. The pipeline answers with `ready`, then the
job's messages, and always ends with one `end`. A job other than `search` gives its answer in one
`result` line before that `end`; `mail.replies` also sends a `reply` line for each reply it finds,
and `import.legacy` a `progress` line for each table.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Mapping, Sequence
from typing import Final, Literal, NotRequired, TextIO, TypedDict, cast, overload

PROTOCOL: Final = 1
# The longest line main reads from the pipeline (main's maxLineLength).
MAX_LINE: Final = 64 * 1024
# The start line is longer: up to 500 keywords of 200 characters and the URLs in its secrets fit
# well inside this. A longer one is cut and then refused as not JSON.
MAX_START_LINE: Final = 1024 * 1024
# Text fields the schema caps at this length; longer text is cut, never refused.
MAX_TEXT: Final = 500
# A reply's body is cut to this first, then halved until its line fits in MAX_LINE (plan D16).
MAX_REPLY_BODY: Final = 16_000
# A refetch result names at most this many failed handles; `failedCount` counts them all.
MAX_FAILED_HANDLES: Final = 200

# What a job uses when its start line leaves the field out.
REPLIES_LIMIT: Final = 60
REFETCH_KEYWORD: Final = "__manual_refetch__"
BACKFILL_MONTHS: Final = 2
BACKFILL_MAX_API_CALLS: Final = 100  # 0 means no ceiling

# The import's report is bounded (plan D4): the Emitter keeps the first of each list and cuts a
# longer name, so an odd old file never makes a line main refuses.
IMPORT_MAX_TABLES: Final = 40
IMPORT_MAX_SKIPPED: Final = 60
IMPORT_MAX_SETTINGS_FILES: Final = 20
IMPORT_MAX_NAME: Final = 64

# The labels a channel below `rules.minMedianViews` or `rules.minUploads30` is archived with
# (plan D8). The old app had no label of its own for these bounds: in
# legacy/lib/features/search/application/auto_clean_controller.dart, `AutoCleanRule._requests`
# archives every bound of the rule (the subscriber band, the median-views band and the
# videos-in-30-days floor) with the rule's one `label`, which `rejectingLabel` clamps to the three
# rejecting tags below and which falls back to "irrelevant". So these bounds use
# `rules.autoClean.label` too. (The old sweep read a missing median or upload count as 0, and kept
# a channel sitting exactly on a bound; it ran only while the rule was enabled. The new gate,
# `signals_verdict` in search/auto_clean.py, reads a missing value as 0, keeps a channel exactly on
# a bound, and runs whether or not the subscriber band is on.)
AUTO_CLEAN_LABELS: Final = ("haramStuff", "irrelevant", "inactive")
AUTO_CLEAN_DEFAULT_LABEL: Final = "irrelevant"

AutoCleanAction = Literal["sweep", "delay", "off"]
LogLevel = Literal["info", "warn", "error"]
KeywordState = Literal["started", "done", "failed"]
Outcome = Literal["kept", "swept", "delayed"]
EndState = Literal["done", "stopped", "failed"]
EndErrorCode = Literal[
    "bad_start",
    "no_youtube_key",
    "blocked",
    "quota",
    "network",
    "crash",
    "mail_not_connected",
    "mail_auth",
    "mail_api",
    "daily_cap_reached",
    "send_uncertain",
    "not_a_video",
    "not_found",
    "no_aws_keys",
    "aws",
    # import.legacy: the old file is missing or can't be read, isn't SQLite, has no `channels`
    # table, or lies inside this app's data folder, or has an unfinished `-wal` beside
    # it (the old app is open); or pipeline.db is newer than this pipeline.
    "source_unreadable",
    "not_sqlite",
    "no_channels_table",
    "source_in_data_dir",
    "old_app_open",
    "store_too_new",
]
ResultKind = Literal[
    "mail.status",
    "mail.send",
    "mail.replies",
    "mail.ack",
    "mail.cancel",
    "video_stats",
    "refetch",
    "backfill",
    "gateways.deploy",
    "gateways.destroy",
    "gateways.test",
    "import.legacy",
]
JobKind = Literal["search"] | ResultKind
BackfillPart = Literal["channels", "videos", "backfill", "backlog"]
SkipReason = Literal["synced", "bookkeeping", "not-ported"]
# Every kind but search, which answers with its `keyword` and `channel` lines instead.
RESULT_KINDS: Final[tuple[ResultKind, ...]] = (
    "mail.status",
    "mail.send",
    "mail.replies",
    "mail.ack",
    "mail.cancel",
    "video_stats",
    "refetch",
    "backfill",
    "gateways.deploy",
    "gateways.destroy",
    "gateways.test",
    "import.legacy",
)


class AutoClean(TypedDict):
    enabled: bool
    minSubscribers: int
    maxSubscribers: int
    belowMin: AutoCleanAction
    aboveMax: AutoCleanAction
    label: str


class Rules(TypedDict):
    countries: list[str]
    perKeyword: int
    sortBy: Literal["relevance", "upload_date", "view_count", "rating"]
    resultsType: Literal["video", "channel"]
    autoClean: AutoClean
    # Plan D8: a kept channel below either bound, once its videos are read, is archived as an
    # auto-clean sweep would (with AUTO_CLEAN_LABELS' label). Absent means None: no bound. Read
    # them with `.get(...)`, so a start line from before step 4 still runs.
    minMedianViews: NotRequired[int | None]
    minUploads30: NotRequired[int | None]


# --- the jobs ---


class SearchJob(TypedDict):
    kind: Literal["search"]
    keywords: list[str]
    startAt: int
    rules: Rules


class MailStatusJob(TypedDict):
    kind: Literal["mail.status"]


class OutgoingMail(TypedDict):
    to: str
    subject: str
    body: str
    mailbox: NotRequired[str]  # needed only when more than one mailbox is connected
    conversationKey: NotRequired[str]
    newThread: NotRequired[bool]
    channelId: NotRequired[str]
    labels: NotRequired[list[str]]
    sendKey: str  # one send per key
    approvedBy: str  # who pressed Send: nothing goes out without a person's approval


class MailSendJob(TypedDict):
    kind: Literal["mail.send"]
    message: OutgoingMail


class MailRepliesJob(TypedDict):
    kind: Literal["mail.replies"]
    mailbox: NotRequired[str]  # every connected mailbox when absent
    conversationKey: NotRequired[str]
    limit: NotRequired[int]  # REPLIES_LIMIT when absent


class MailAckJob(TypedDict):
    kind: Literal["mail.ack"]
    messageIds: list[str]


class MailCancelJob(TypedDict):
    kind: Literal["mail.cancel"]
    conversationKey: str


class VideoStatsJob(TypedDict):
    kind: Literal["video_stats"]
    videoUrl: str


class RefetchJob(TypedDict):
    kind: Literal["refetch"]
    handles: list[str]
    keyword: NotRequired[str]  # REFETCH_KEYWORD when absent
    autoClean: AutoClean | None


class BackfillJob(TypedDict):
    kind: Literal["backfill"]
    only: list[BackfillPart]
    handles: NotRequired[list[str]]
    months: NotRequired[int]  # BACKFILL_MONTHS when absent
    maxApiCalls: NotRequired[int]  # BACKFILL_MAX_API_CALLS when absent
    includeAbsent: NotRequired[bool]
    limit: NotRequired[int]


class GatewaysDeployJob(TypedDict):
    kind: Literal["gateways.deploy"]
    regions: list[str]


class GatewayRef(TypedDict):
    region: str
    apiId: str


class GatewaysDestroyJob(TypedDict):
    kind: Literal["gateways.destroy"]
    gateways: list[GatewayRef]


class GatewaysTestJob(TypedDict):
    kind: Literal["gateways.test"]


class ImportLegacyJob(TypedDict):
    """Copy the old app's gratovo.db (opened read-only) into pipeline.db (plan D3 to D5)."""

    kind: Literal["import.legacy"]
    source: str  # a full path
    dryRun: bool  # write nothing: count what a real import would do
    backupDir: str | None  # a full path; needed unless dryRun


type Job = (
    SearchJob
    | MailStatusJob
    | MailSendJob
    | MailRepliesJob
    | MailAckJob
    | MailCancelJob
    | VideoStatsJob
    | RefetchJob
    | BackfillJob
    | GatewaysDeployJob
    | GatewaysDestroyJob
    | GatewaysTestJob
    | ImportLegacyJob
)


# --- the rest of the start line ---


class Parallel(TypedDict):
    enabled: bool
    maxWorkers: int


class Proxies(TypedDict):
    enabled: bool
    includeDirect: bool


class MailboxSettings(TypedDict):
    address: str
    dailyCap: int
    warmupStartedOn: str | None  # YYYY-MM-DD


class MailSettings(TypedDict):
    label: str
    senderName: str | None
    mailboxes: list[MailboxSettings]


class Settings(TypedDict):
    pacing: NotRequired[Literal["normal", "fast"]]
    parallel: NotRequired[Parallel]
    proxies: NotRequired[Proxies]
    mail: NotRequired[MailSettings]


class MailClient(TypedDict):
    id: str
    secret: str


class MailboxSecret(TypedDict):
    address: str
    refreshToken: str


class MailSecrets(TypedDict):
    client: MailClient
    mailboxes: list[MailboxSecret]


class AwsKeys(TypedDict):
    accessKeyId: str
    secretAccessKey: str


class Secrets(TypedDict):
    # Sent with every job: None and [] when it needs none of them.
    youtubeKey: str | None
    proxyUrls: list[str]
    gatewayUrls: list[str]
    mail: NotRequired[MailSecrets]
    aws: NotRequired[AwsKeys]


class Start(TypedDict):
    type: Literal["start"]
    protocol: Literal[1]
    source: Literal["live", "example"]
    dataDir: str
    worker: str
    job: Job
    settings: Settings
    secrets: Secrets


# --- the results: one per kind but search, written with Emitter.result ---


class MailError(TypedDict):
    code: Literal["mail_auth", "mail_api", "network"]
    message: str


class MailCounters(TypedDict):
    conversations: int
    sent: int
    awaitingReply: int
    replied: int
    pendingSteps: int
    dueSteps: int
    failedSteps: int
    unreportedReplies: int


class MailLimits(TypedDict):
    dailyCap: int
    warmupStartedOn: str | None
    sentToday: int
    leftToday: int


class MailAccountStatus(TypedDict):
    account: str | None
    connected: bool
    counters: MailCounters | None
    limits: MailLimits | None
    lastSweepAt: str | None
    error: MailError | None


class MailStatusData(TypedDict):
    configured: bool
    label: str
    senderName: str | None
    accounts: list[MailAccountStatus]


class MailSendData(TypedDict):
    duplicate: bool  # the key had sent already: nothing new went out
    account: str
    conversationKey: str
    messageId: str
    threadId: str | None
    rfcMessageId: str | None
    labelled: bool
    threaded: bool
    to: str
    subject: str | None
    sentAt: str


class MailAccountSweep(TypedDict):
    account: str
    checked: int
    replies: int
    cancelledQueued: int
    error: MailError | None


class MailRepliesData(TypedDict):
    accounts: list[MailAccountSweep]


class MailAckData(TypedDict):
    acknowledged: int


class MailCancelData(TypedDict):
    cancelled: int
    closed: bool


class VideoStatsData(TypedDict):
    videoId: str
    views: int
    fetchedAt: str


class RefetchData(TypedDict):
    processed: int
    swept: int
    deferred: int
    failedCount: int
    failed: list[str]  # cut to MAX_FAILED_HANDLES by the Emitter


class TargetsFilled(TypedDict):
    targets: int
    filled: int


class BackfillSaved(TypedDict):
    channels: int
    saved: int


class BacklogStamped(TypedDict):
    stamped: int


class BackfillData(TypedDict):
    channels: TargetsFilled | None
    videos: TargetsFilled | None
    backfill: BackfillSaved | None
    backlog: BacklogStamped | None
    apiCalls: int
    budgetReached: bool


class DeployedGateway(TypedDict):
    region: str
    apiId: str
    url: str  # a secret: main stores it and never logs it


class RegionFailure(TypedDict):
    region: str
    message: str


class GatewaysDeployData(TypedDict):
    deployed: list[DeployedGateway]
    failed: list[RegionFailure]


class GatewayFailure(TypedDict):
    region: str
    apiId: str
    message: str


class GatewaysDestroyData(TypedDict):
    deleted: list[GatewayRef]
    failed: list[GatewayFailure]


class GatewayTest(TypedDict):
    region: str | None
    status: int | None
    ok: bool
    message: str | None


class GatewaysTestData(TypedDict):
    results: list[GatewayTest]


class ImportTable(TypedDict):
    name: str
    inOld: int  # rows in the old file
    toAdd: int  # rows a real import adds (or added)
    already: int  # rows this app holds already: they win


class ImportSkipped(TypedDict):
    name: str
    rows: int
    why: SkipReason  # the sync brings it, old bookkeeping, or never ported


class ImportUnsent(TypedDict):
    outbox: int  # `_outbox` rows
    activity: int  # `activity_log` rows with synced = 0


class ImportSettingsFile(TypedDict):
    name: str
    found: bool


class ImportReport(TypedDict):
    """The import's result, plan D4. The same field names as `ImportReport` in packages/ipc."""

    source: str
    tables: list[ImportTable]  # at most IMPORT_MAX_TABLES
    skipped: list[ImportSkipped]  # at most IMPORT_MAX_SKIPPED
    unsent: ImportUnsent
    settingsFiles: list[ImportSettingsFile]  # at most IMPORT_MAX_SETTINGS_FILES
    dryRun: bool
    backup: str | None  # the copy of pipeline.db made first; None on a dry run or a first import


class BadStartError(ValueError):
    """The start line was unusable. The message names the field, never its value."""


# --- reading the start line ---

_COUNTRY = re.compile(r"[A-Z]{2}")
# The schema's patterns. `[0-9]`, not `\d`: Python's `\d` also takes other scripts' digits.
_EMAIL = re.compile(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+")
_HANDLE = re.compile(r"@[A-Za-z0-9._-]{1,100}")
_REGION = re.compile(r"[a-z]{2}(-[a-z]+)+-[0-9]")
_API_ID = re.compile(r"[a-z0-9]{1,32}")
_GMAIL_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_CHANNEL_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_SEND_KEY = re.compile(r"[A-Za-z0-9_:.-]+")
_AWS_KEY_ID = re.compile(r"[A-Z0-9]{16,128}")
# A full path: a drive (`C:\`), a share (`\\server`) or a POSIX root (the tests' tmp_path on
# Linux). Never a NUL.
_ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|[\\/])[^\x00]*")
_INDEX_MAX = 10_000
_COUNT_MAX = 100_000_000
_JOB_KINDS: Final[tuple[JobKind, ...]] = ("search", *RESULT_KINDS)
_BACKFILL_PARTS: Final[tuple[BackfillPart, ...]] = ("channels", "videos", "backfill", "backlog")


def _object(
    value: object, where: str, required: set[str], optional: frozenset[str] = frozenset()
) -> dict[str, object]:
    if not isinstance(value, dict):
        raise BadStartError(f"{where} must be an object")
    found = cast("dict[str, object]", value)
    missing = required - found.keys()
    if missing:
        raise BadStartError(f"{where} is missing {', '.join(sorted(missing))}")
    extra = found.keys() - required - optional
    if extra:
        raise BadStartError(f"{where} has unknown fields")
    return found


def _string(value: object, where: str, low: int, high: int) -> str:
    if not isinstance(value, str) or not low <= len(value) <= high:
        raise BadStartError(f"{where} must be text of {low} to {high} characters")
    return value


def _header(value: object, where: str, high: int) -> str:
    """Text that goes into a mail header: a line break there would start a new header. Every
    boundary `str.splitlines` knows, which is what the email module refuses."""
    text = _string(value, where, 0, high)
    if len(f"{text}x".splitlines()) > 1:
        raise BadStartError(f"{where} must be one line")
    return text


def _matching(value: object, where: str, pattern: re.Pattern[str], what: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise BadStartError(f"{where} must be {what}")
    return value


def _email(value: object, where: str) -> str:
    return _matching(_string(value, where, 3, 320), where, _EMAIL, "an email address")


def _integer(value: object, where: str, low: int, high: int) -> int:
    # bool is an int in Python, but not a number on the wire.
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise BadStartError(f"{where} must be a whole number from {low} to {high}")
    return value


def _boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise BadStartError(f"{where} must be true or false")
    return value


def _choice[T: str](value: object, where: str, choices: Sequence[T]) -> T:
    for choice in choices:
        if value == choice:
            return choice
    raise BadStartError(f"{where} must be one of {', '.join(choices)}")


def _list(value: object, where: str, high: int, low: int = 0) -> list[object]:
    if not isinstance(value, list):
        raise BadStartError(f"{where} must be a list")
    items = cast("list[object]", value)
    if not low <= len(items) <= high:
        raise BadStartError(f"{where} must hold {low} to {high} items")
    return items


def _unique(values: list[str], where: str) -> list[str]:
    """values, unless two are the same once lowercased."""
    if len({value.lower() for value in values}) != len(values):
        raise BadStartError(f"{where} must be unique")
    return values


def _keyword(value: object, where: str) -> str:
    keyword = _string(value, where, 1, 200)
    if keyword != keyword.strip():
        raise BadStartError(f"{where} must have no spaces around a keyword")
    return keyword


def _handles(value: object, where: str, high: int) -> list[str]:
    handles = [
        _matching(item, where, _HANDLE, "@handles") for item in _list(value, where, high, low=1)
    ]
    return _unique(handles, where)


def _auto_clean(value: object, where: str) -> AutoClean:
    clean = _object(
        value,
        where,
        {"enabled", "minSubscribers", "maxSubscribers", "belowMin", "aboveMax", "label"},
    )
    actions: tuple[AutoCleanAction, ...] = ("sweep", "delay", "off")
    return {
        "enabled": _boolean(clean["enabled"], f"{where}.enabled"),
        "minSubscribers": _integer(
            clean["minSubscribers"], f"{where}.minSubscribers", 0, _COUNT_MAX
        ),
        "maxSubscribers": _integer(
            clean["maxSubscribers"], f"{where}.maxSubscribers", 0, _COUNT_MAX
        ),
        "belowMin": _choice(clean["belowMin"], f"{where}.belowMin", actions),
        "aboveMax": _choice(clean["aboveMax"], f"{where}.aboveMax", actions),
        "label": _string(clean["label"], f"{where}.label", 1, 40),
    }


def _rules(value: object) -> Rules:
    raw = _object(
        value,
        "rules",
        {"countries", "perKeyword", "sortBy", "resultsType", "autoClean"},
        frozenset({"minMedianViews", "minUploads30"}),
    )
    countries: list[str] = []
    for item in _list(raw["countries"], "rules.countries", 250):
        if not isinstance(item, str) or not _COUNTRY.fullmatch(item):
            raise BadStartError("rules.countries must be two-letter country codes")
        countries.append(item)
    rules: Rules = {
        "countries": countries,
        "perKeyword": _integer(raw["perKeyword"], "rules.perKeyword", 1, 1000),
        "sortBy": _choice(
            raw["sortBy"], "rules.sortBy", ("relevance", "upload_date", "view_count", "rating")
        ),
        "resultsType": _choice(raw["resultsType"], "rules.resultsType", ("video", "channel")),
        "autoClean": _auto_clean(raw["autoClean"], "rules.autoClean"),
    }
    # Optional, as on the wire: a start line from before step 4 has neither (None: no bound).
    if "minMedianViews" in raw:
        median = raw["minMedianViews"]
        rules["minMedianViews"] = (
            None if median is None else _integer(median, "rules.minMedianViews", 0, _COUNT_MAX)
        )
    if "minUploads30" in raw:
        uploads = raw["minUploads30"]
        rules["minUploads30"] = (
            None if uploads is None else _integer(uploads, "rules.minUploads30", 0, _INDEX_MAX)
        )
    return rules


def _search_job(value: object) -> SearchJob:
    raw = _object(value, "job", {"kind", "keywords", "startAt", "rules"})
    keywords = [
        _keyword(item, "job.keywords")
        for item in _list(raw["keywords"], "job.keywords", 500, low=1)
    ]
    _unique(keywords, "job.keywords")
    start_at = _integer(raw["startAt"], "job.startAt", 0, _INDEX_MAX)
    if start_at >= len(keywords):
        raise BadStartError("job.startAt must name a keyword")
    return {
        "kind": "search",
        "keywords": keywords,
        "startAt": start_at,
        "rules": _rules(raw["rules"]),
    }


def _outgoing_mail(value: object) -> OutgoingMail:
    where = "job.message"
    raw = _object(
        value,
        where,
        {"to", "subject", "body", "sendKey", "approvedBy"},
        frozenset({"mailbox", "conversationKey", "newThread", "channelId", "labels"}),
    )
    send_key = _string(raw["sendKey"], f"{where}.sendKey", 8, 200)
    mail: OutgoingMail = {
        "to": _email(raw["to"], f"{where}.to"),
        "subject": _header(raw["subject"], f"{where}.subject", 998),
        "body": _string(raw["body"], f"{where}.body", 1, 100_000),
        "sendKey": _matching(
            send_key, f"{where}.sendKey", _SEND_KEY, "letters, digits and _ : . - only"
        ),
        "approvedBy": _string(raw["approvedBy"], f"{where}.approvedBy", 1, 100),
    }
    if "mailbox" in raw:
        mail["mailbox"] = _email(raw["mailbox"], f"{where}.mailbox")
    if "conversationKey" in raw:
        mail["conversationKey"] = _string(
            raw["conversationKey"], f"{where}.conversationKey", 1, 200
        )
    if "newThread" in raw:
        mail["newThread"] = _boolean(raw["newThread"], f"{where}.newThread")
    if "channelId" in raw:
        mail["channelId"] = _matching(
            raw["channelId"], f"{where}.channelId", _CHANNEL_ID, "a channel id"
        )
    if "labels" in raw:
        mail["labels"] = [
            _string(label, f"{where}.labels", 1, 100)
            for label in _list(raw["labels"], f"{where}.labels", 10)
        ]
    return mail


def _mail_replies_job(raw: dict[str, object]) -> MailRepliesJob:
    job: MailRepliesJob = {"kind": "mail.replies"}
    if "mailbox" in raw:
        job["mailbox"] = _email(raw["mailbox"], "job.mailbox")
    if "conversationKey" in raw:
        job["conversationKey"] = _string(raw["conversationKey"], "job.conversationKey", 1, 200)
    if "limit" in raw:
        job["limit"] = _integer(raw["limit"], "job.limit", 1, 500)
    return job


def _backfill_job(raw: dict[str, object]) -> BackfillJob:
    only: list[BackfillPart] = [
        _choice(part, "job.only", _BACKFILL_PARTS)
        for part in _list(raw["only"], "job.only", 4, low=1)
    ]
    if len(set(only)) != len(only):
        raise BadStartError("job.only must not repeat a part")
    job: BackfillJob = {"kind": "backfill", "only": only}
    if "handles" in raw:
        job["handles"] = [
            _matching(item, "job.handles", _HANDLE, "@handles")
            for item in _list(raw["handles"], "job.handles", 500, low=1)
        ]
    if "months" in raw:
        job["months"] = _integer(raw["months"], "job.months", 1, 24)
    if "maxApiCalls" in raw:
        job["maxApiCalls"] = _integer(raw["maxApiCalls"], "job.maxApiCalls", 0, 10_000)
    if "includeAbsent" in raw:
        job["includeAbsent"] = _boolean(raw["includeAbsent"], "job.includeAbsent")
    if "limit" in raw:
        job["limit"] = _integer(raw["limit"], "job.limit", 1, 100_000)
    return job


def _path(value: object, where: str) -> str:
    return _matching(_string(value, where, 1, 1024), where, _ABSOLUTE_PATH, "a full path")


def _import_legacy_job(raw: dict[str, object]) -> ImportLegacyJob:
    backup = raw["backupDir"]
    job: ImportLegacyJob = {
        "kind": "import.legacy",
        "source": _path(raw["source"], "job.source"),
        "dryRun": _boolean(raw["dryRun"], "job.dryRun"),
        "backupDir": None if backup is None else _path(backup, "job.backupDir"),
    }
    # A real import backs up pipeline.db first (plan D5), so it needs somewhere to put the copy.
    if not job["dryRun"] and job["backupDir"] is None:
        raise BadStartError("job.backupDir is needed for a real import")
    return job


def _gateway_ref(value: object) -> GatewayRef:
    raw = _object(value, "job.gateways", {"region", "apiId"})
    return {
        "region": _matching(raw["region"], "job.gateways.region", _REGION, "an AWS region"),
        "apiId": _matching(raw["apiId"], "job.gateways.apiId", _API_ID, "an API id"),
    }


def _job(job: object) -> Job:
    if not isinstance(job, dict):
        raise BadStartError("job must be an object")
    value = cast("dict[str, object]", job)
    kind = _choice(value.get("kind"), "job.kind", _JOB_KINDS)
    if kind == "search":
        return _search_job(value)
    if kind == "mail.status":
        _object(value, "job", {"kind"})
        return {"kind": "mail.status"}
    if kind == "mail.send":
        raw = _object(value, "job", {"kind", "message"})
        return {"kind": "mail.send", "message": _outgoing_mail(raw["message"])}
    if kind == "mail.replies":
        optional = frozenset({"mailbox", "conversationKey", "limit"})
        return _mail_replies_job(_object(value, "job", {"kind"}, optional))
    if kind == "mail.ack":
        raw = _object(value, "job", {"kind", "messageIds"})
        ids = _list(raw["messageIds"], "job.messageIds", 500, low=1)
        return {
            "kind": "mail.ack",
            "messageIds": [
                _matching(item, "job.messageIds", _GMAIL_ID, "Gmail message ids") for item in ids
            ],
        }
    if kind == "mail.cancel":
        raw = _object(value, "job", {"kind", "conversationKey"})
        return {
            "kind": "mail.cancel",
            "conversationKey": _string(raw["conversationKey"], "job.conversationKey", 1, 200),
        }
    if kind == "video_stats":
        raw = _object(value, "job", {"kind", "videoUrl"})
        return {
            "kind": "video_stats",
            "videoUrl": _string(raw["videoUrl"], "job.videoUrl", 1, 2000),
        }
    if kind == "refetch":
        raw = _object(value, "job", {"kind", "handles", "autoClean"}, frozenset({"keyword"}))
        clean = raw["autoClean"]
        refetch: RefetchJob = {
            "kind": "refetch",
            "handles": _handles(raw["handles"], "job.handles", 2000),
            "autoClean": None if clean is None else _auto_clean(clean, "job.autoClean"),
        }
        if "keyword" in raw:
            refetch["keyword"] = _keyword(raw["keyword"], "job.keyword")
        return refetch
    if kind == "backfill":
        optional = frozenset({"handles", "months", "maxApiCalls", "includeAbsent", "limit"})
        return _backfill_job(_object(value, "job", {"kind", "only"}, optional))
    if kind == "gateways.deploy":
        raw = _object(value, "job", {"kind", "regions"})
        regions = [
            _matching(item, "job.regions", _REGION, "AWS regions")
            for item in _list(raw["regions"], "job.regions", 20, low=1)
        ]
        return {"kind": "gateways.deploy", "regions": _unique(regions, "job.regions")}
    if kind == "gateways.destroy":
        raw = _object(value, "job", {"kind", "gateways"})
        gateways = _list(raw["gateways"], "job.gateways", 50, low=1)
        return {"kind": "gateways.destroy", "gateways": [_gateway_ref(g) for g in gateways]}
    if kind == "import.legacy":
        return _import_legacy_job(_object(value, "job", {"kind", "source", "dryRun", "backupDir"}))
    _object(value, "job", {"kind"})
    return {"kind": "gateways.test"}


def _mail_settings(value: object) -> MailSettings:
    raw = _object(value, "settings.mail", {"label", "senderName", "mailboxes"})
    sender = raw["senderName"]
    mailboxes: list[MailboxSettings] = []
    for item in _list(raw["mailboxes"], "settings.mail.mailboxes", 20):
        box = _object(item, "settings.mail.mailboxes", {"address", "dailyCap", "warmupStartedOn"})
        warmup = box["warmupStartedOn"]
        mailboxes.append(
            {
                "address": _email(box["address"], "settings.mail.mailboxes.address"),
                "dailyCap": _integer(box["dailyCap"], "settings.mail.mailboxes.dailyCap", 10, 50),
                "warmupStartedOn": None
                if warmup is None
                else _matching(
                    warmup, "settings.mail.mailboxes.warmupStartedOn", _DAY, "a YYYY-MM-DD date"
                ),
            }
        )
    return {
        "label": _string(raw["label"], "settings.mail.label", 1, 100),
        "senderName": None if sender is None else _header(sender, "settings.mail.senderName", 100),
        "mailboxes": mailboxes,
    }


def _settings(value: object) -> Settings:
    raw = _object(value, "settings", set(), frozenset({"pacing", "parallel", "proxies", "mail"}))
    settings: Settings = {}
    if "pacing" in raw:
        settings["pacing"] = _choice(raw["pacing"], "settings.pacing", ("normal", "fast"))
    if "parallel" in raw:
        parallel = _object(raw["parallel"], "settings.parallel", {"enabled", "maxWorkers"})
        settings["parallel"] = {
            "enabled": _boolean(parallel["enabled"], "settings.parallel.enabled"),
            "maxWorkers": _integer(parallel["maxWorkers"], "settings.parallel.maxWorkers", 1, 16),
        }
    if "proxies" in raw:
        proxies = _object(raw["proxies"], "settings.proxies", {"enabled", "includeDirect"})
        settings["proxies"] = {
            "enabled": _boolean(proxies["enabled"], "settings.proxies.enabled"),
            "includeDirect": _boolean(proxies["includeDirect"], "settings.proxies.includeDirect"),
        }
    if "mail" in raw:
        settings["mail"] = _mail_settings(raw["mail"])
    return settings


def _mail_secrets(value: object) -> MailSecrets:
    raw = _object(value, "secrets.mail", {"client", "mailboxes"})
    client = _object(raw["client"], "secrets.mail.client", {"id", "secret"})
    mailboxes: list[MailboxSecret] = []
    for item in _list(raw["mailboxes"], "secrets.mail.mailboxes", 20):
        box = _object(item, "secrets.mail.mailboxes", {"address", "refreshToken"})
        mailboxes.append(
            {
                "address": _email(box["address"], "secrets.mail.mailboxes.address"),
                "refreshToken": _string(
                    box["refreshToken"], "secrets.mail.mailboxes.refreshToken", 1, 2000
                ),
            }
        )
    return {
        "client": {
            "id": _string(client["id"], "secrets.mail.client.id", 1, 300),
            "secret": _string(client["secret"], "secrets.mail.client.secret", 1, 300),
        },
        "mailboxes": mailboxes,
    }


def _secrets(value: object) -> Secrets:
    raw = _object(
        value, "secrets", {"youtubeKey", "proxyUrls", "gatewayUrls"}, frozenset({"mail", "aws"})
    )
    key = raw["youtubeKey"]
    secrets: Secrets = {
        "youtubeKey": None if key is None else _string(key, "secrets.youtubeKey", 1, 200),
        "proxyUrls": [
            _string(u, "secrets.proxyUrls", 1, 2000)
            for u in _list(raw["proxyUrls"], "secrets.proxyUrls", 100)
        ],
        "gatewayUrls": [
            _string(u, "secrets.gatewayUrls", 1, 2000)
            for u in _list(raw["gatewayUrls"], "secrets.gatewayUrls", 100)
        ],
    }
    if "mail" in raw:
        secrets["mail"] = _mail_secrets(raw["mail"])
    if "aws" in raw:
        aws = _object(raw["aws"], "secrets.aws", {"accessKeyId", "secretAccessKey"})
        secrets["aws"] = {
            "accessKeyId": _matching(
                aws["accessKeyId"], "secrets.aws.accessKeyId", _AWS_KEY_ID, "an AWS access key id"
            ),
            "secretAccessKey": _string(
                aws["secretAccessKey"], "secrets.aws.secretAccessKey", 1, 200
            ),
        }
    return secrets


def parse_start(line: str) -> Start:
    """Reads and checks the start line. Raises BadStartError, which never repeats a value."""
    try:
        value: object = json.loads(line)
    except ValueError:
        raise BadStartError("the start line must be JSON") from None
    raw = _object(
        value,
        "start",
        {"type", "protocol", "source", "dataDir", "worker", "job", "settings", "secrets"},
    )
    _choice(raw["type"], "type", ("start",))
    if _integer(raw["protocol"], "protocol", 1, 1) != PROTOCOL:
        raise BadStartError("protocol must be 1")
    source = _choice(raw["source"], "source", ("live", "example"))
    data_dir = _string(raw["dataDir"], "dataDir", 1, 1024)
    worker = _string(raw["worker"], "worker", 1, 64)
    job = _job(raw["job"])
    # Example data fakes the other jobs on main's side (steps 5 to 9): only a search runs on it.
    if source == "example" and job["kind"] == "import.legacy":
        # It writes the live pipeline.db (plan D3): example data never takes an import.
        raise BadStartError("only a search runs on example data: the import is for live data")
    if source == "example" and job["kind"] != "search":
        raise BadStartError("only a search runs on example data")
    settings = _settings(raw["settings"])
    secrets = _secrets(raw["secrets"])
    # A mailbox's address is read from the settings, never the secrets (ADR 0015 §8), so every
    # connected mailbox must be listed there.
    if not _mailboxes_listed(settings, secrets):
        raise BadStartError("every connected mailbox must be listed in settings.mail.mailboxes")
    return {
        "type": "start",
        "protocol": 1,
        "source": source,
        "dataDir": data_dir,
        "worker": worker,
        "job": job,
        "settings": settings,
        "secrets": secrets,
    }


def _mailboxes_listed(settings: Settings, secrets: Secrets) -> bool:
    mail = secrets.get("mail")
    listing = settings.get("mail")
    listed = {e["address"].strip().lower() for e in (listing["mailboxes"] if listing else [])}
    return mail is None or all(m["address"].strip().lower() in listed for m in mail["mailboxes"])


def listen_for_stop(stream: TextIO, on_stop: Callable[[], None]) -> threading.Thread:
    """Watches stdin after the start line; calls on_stop once, on a stop line or when the app
    closes the stream (it quit or crashed: nobody is left to read the results)."""

    def listen() -> None:
        for line in stream:
            try:
                message: object = json.loads(line)
            except ValueError:
                continue
            if (
                isinstance(message, dict)
                and cast("dict[str, object]", message).get("type") == "stop"
            ):
                break
        on_stop()

    thread = threading.Thread(target=listen, name="stdin", daemon=True)
    thread.start()
    return thread


# --- writing ---


def _cut(text: str, limit: int = MAX_TEXT) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _line(message: Mapping[str, object]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"


def _fits(line: str) -> bool:
    # Main counts UTF-16 units; UTF-8 bytes are never fewer, so a line that fits here fits there.
    return len(line.encode("utf-8")) <= MAX_LINE


def _fit_messages(value: object) -> object:
    """value with every `message` text cut to the schema's 500 characters."""
    if isinstance(value, dict):
        return {
            key: _cut(item) if key == "message" and isinstance(item, str) else _fit_messages(item)
            for key, item in cast("dict[str, object]", value).items()
        }
    if isinstance(value, list):
        return [_fit_messages(item) for item in cast("list[object]", value)]
    return value


def _fit_import_report(report: dict[str, object]) -> None:
    """Keeps the report inside the schema's bounds, in place: the first entries of each list,
    and each name cut to IMPORT_MAX_NAME characters."""
    for key, limit in (
        ("tables", IMPORT_MAX_TABLES),
        ("skipped", IMPORT_MAX_SKIPPED),
        ("settingsFiles", IMPORT_MAX_SETTINGS_FILES),
    ):
        entries = cast("list[dict[str, object]]", report[key])[:limit]
        report[key] = [
            {**entry, "name": _cut(cast("str", entry["name"]), IMPORT_MAX_NAME) or "?"}
            for entry in entries
        ]


class Emitter:
    """Writes messages to stdout, one line each. Safe to share between threads."""

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def _write(self, line: str) -> None:
        with self._lock:
            self._stream.write(line)
            self._stream.flush()

    def _send(self, message: Mapping[str, object]) -> None:
        self._write(_line(message))

    def ready(self) -> None:
        from gratovo_pipeline import __version__

        self._send({"type": "ready", "protocol": PROTOCOL, "version": __version__})

    def run(self, *, total: int, start_at: int) -> None:
        self._send({"type": "run", "state": "running", "total": total, "startAt": start_at})

    def keyword(
        self,
        *,
        index: int,
        total: int,
        keyword: str,
        state: KeywordState,
        found: int | None = None,
        kept: int | None = None,
        error: str | None = None,
    ) -> None:
        message: dict[str, object] = {
            "type": "keyword",
            "index": index,
            "total": total,
            "keyword": keyword,
            "state": state,
        }
        if found is not None:
            message["found"] = found
        if kept is not None:
            message["kept"] = kept
        if error:
            message["error"] = _cut(error)
        self._send(message)

    def channel(
        self,
        *,
        keyword: str,
        channel_id: str,
        handle: str | None,
        name: str,
        subscribers: int | None,
        median_views: int | None,
        country: str | None,
        outcome: Outcome,
    ) -> None:
        self._send(
            {
                "type": "channel",
                "keyword": keyword,
                "channelId": channel_id,
                "handle": handle[:300] if handle else None,
                "name": name[:300] or channel_id,
                "subscribers": subscribers,
                "medianViews": median_views,
                "country": country if country and _COUNTRY.fullmatch(country) else None,
                "outcome": outcome,
            }
        )

    def progress(self, *, table: str, done: int, total: int) -> None:
        """How far the import has got: after each table is copied (or counted, on a dry run),
        `done` of `total` tables are finished, `table` included."""
        self._send(
            {
                "type": "progress",
                "table": _cut(table, IMPORT_MAX_NAME) or "?",
                "done": done,
                "total": total,
            }
        )

    def log(self, level: LogLevel, text: str) -> None:
        self._send({"type": "log", "level": level, "text": _cut(text)})

    def reply(
        self,
        *,
        account: str,
        conversation_key: str,
        channel_id: str | None,
        message_id: str,
        sender: str,
        sender_name: str | None,
        subject: str,
        body: str,
        received_at: str | None,
        is_first_reply: bool,
        cancelled_follow_ups: int,
    ) -> None:
        """One reply a sweep found (`sender` is the wire's `from`). A sweep's bodies together
        would pass the line limit, so each reply is its own line: the body is cut to
        MAX_REPLY_BODY, then halved until the line fits, and `bodyCut` says so."""
        cut = len(body) > MAX_REPLY_BODY
        if cut:
            body = body[:MAX_REPLY_BODY]
        message: dict[str, object] = {
            "type": "reply",
            "account": account,
            "conversationKey": _cut(conversation_key, 200),
            "channelId": channel_id if channel_id and _CHANNEL_ID.fullmatch(channel_id) else None,
            "messageId": message_id,
            "from": _cut(sender, 320),
            "fromName": None if sender_name is None else _cut(sender_name, 300),
            "subject": _cut(subject, 998),
            "body": body,
            "bodyCut": cut,
            "receivedAt": received_at,
            "isFirstReply": is_first_reply,
            "cancelledFollowUps": cancelled_follow_ups,
        }
        line = _line(message)
        # Escapes can make a line up to six times its text (`\u0001`), so halve until it fits.
        while not _fits(line) and body:
            body = body[: len(body) // 2]
            message["body"] = body
            message["bodyCut"] = True
            line = _line(message)
        self._write(line)

    @overload
    def result(self, kind: Literal["mail.status"], data: MailStatusData) -> None: ...
    @overload
    def result(self, kind: Literal["mail.send"], data: MailSendData) -> None: ...
    @overload
    def result(self, kind: Literal["mail.replies"], data: MailRepliesData) -> None: ...
    @overload
    def result(self, kind: Literal["mail.ack"], data: MailAckData) -> None: ...
    @overload
    def result(self, kind: Literal["mail.cancel"], data: MailCancelData) -> None: ...
    @overload
    def result(self, kind: Literal["video_stats"], data: VideoStatsData) -> None: ...
    @overload
    def result(self, kind: Literal["refetch"], data: RefetchData) -> None: ...
    @overload
    def result(self, kind: Literal["backfill"], data: BackfillData) -> None: ...
    @overload
    def result(self, kind: Literal["gateways.deploy"], data: GatewaysDeployData) -> None: ...
    @overload
    def result(self, kind: Literal["gateways.destroy"], data: GatewaysDestroyData) -> None: ...
    @overload
    def result(self, kind: Literal["gateways.test"], data: GatewaysTestData) -> None: ...
    @overload
    def result(self, kind: Literal["import.legacy"], data: ImportReport) -> None: ...
    def result(self, kind: ResultKind, data: Mapping[str, object]) -> None:
        """The job's answer: at most once, before `end`; on `done` (and on `stopped` for refetch
        and backfill), never on `failed`. Messages are cut to fit, as in `end`."""
        fitted = cast("dict[str, object]", _fit_messages(dict(data)))
        if kind == "refetch":
            fitted["failed"] = cast("list[object]", fitted["failed"])[:MAX_FAILED_HANDLES]
        if kind == "mail.send":
            rfc_id = fitted["rfcMessageId"]
            # Half an id is no id: one too long to send is left out.
            if isinstance(rfc_id, str) and len(rfc_id) > 998:
                fitted["rfcMessageId"] = None
        if kind == "import.legacy":
            _fit_import_report(fitted)
        self._send({"type": "result", "kind": kind, "data": fitted})

    def end(
        self,
        *,
        state: EndState,
        at: int,
        found: int,
        kept: int,
        error: tuple[EndErrorCode, str] | None = None,
    ) -> None:
        """The last line. For a job other than `search`, at, found and kept are 0: its answer is
        its `result`."""
        message: dict[str, object] = {
            "type": "end",
            "state": state,
            "at": at,
            "found": found,
            "kept": kept,
        }
        if error is not None:
            message["error"] = {"code": error[0], "message": _cut(error[1])}
        self._send(message)
