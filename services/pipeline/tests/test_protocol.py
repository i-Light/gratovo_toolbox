import copy
import importlib
import io
import json
import socket
import sys
import threading
from collections.abc import Callable, Iterator
from typing import Any, cast

import pytest
from helpers import START, changed, schema_errors

from gratovo_pipeline import __main__ as gratovo_main
from gratovo_pipeline import jobs, net, protocol
from gratovo_pipeline.protocol import BadStartError, Emitter, Start, listen_for_stop, parse_start

Check = Callable[[str], dict[str, Any]]


def test_a_good_start_parses_to_the_same_values() -> None:
    assert parse_start(json.dumps(START)) == START


def test_settings_may_be_empty() -> None:
    assert parse_start(json.dumps(changed("settings", {})))["settings"] == {}


# Each of these breaks the schema, so the JSON Schema refuses it too.
SCHEMA_BREAKS: list[tuple[str, object]] = [
    ("type", "stop"),
    ("protocol", 2),
    ("source", "prod"),
    ("dataDir", ""),
    ("worker", "x" * 65),
    ("job.kind", "refetch"),
    ("job.keywords", []),
    ("job.keywords", ["x" * 201]),
    ("job.startAt", -1),
    ("job.startAt", 1.5),
    ("job.startAt", True),
    ("job.rules.countries", ["usa"]),
    ("job.rules.perKeyword", 0),
    ("job.rules.sortBy", "newest"),
    ("job.rules.autoClean.belowMin", "keep"),
    ("job.rules.autoClean.extra", 1),
    ("settings.pacing", "slow"),
    ("settings.parallel", {"enabled": True, "maxWorkers": 0}),
    ("secrets.youtubeKey", ""),
    ("secrets.proxyUrls", "http://a"),
    ("secrets", ...),
    ("extra", True),
]


@pytest.mark.parametrize(("path", "value"), SCHEMA_BREAKS)
def test_a_start_that_breaks_the_schema_is_refused(
    path: str, value: object, protocol_schema: dict[str, Any]
) -> None:
    bad = changed(path, value)
    assert schema_errors(protocol_schema["toPipeline"], bad) != []
    with pytest.raises(BadStartError):
        parse_start(json.dumps(bad))


# The checks JSON Schema can't express, which zod makes with refinements.
@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("job.startAt", 2),
        ("job.keywords", ["Claude Code", "claude code"]),
        ("job.keywords", [" ai "]),
    ],
)
def test_a_start_that_breaks_a_refinement_is_refused(path: str, value: object) -> None:
    with pytest.raises(BadStartError):
        parse_start(json.dumps(changed(path, value)))


@pytest.mark.parametrize("line", ["", "not json", "[]", "null", '{"type": "start"}'])
def test_a_start_line_that_is_not_a_start_is_refused(line: str) -> None:
    with pytest.raises(BadStartError):
        parse_start(line)


def test_the_refusal_never_repeats_a_secret() -> None:
    bad = changed("secrets.proxyUrls", ["http://user:hunter2@proxy.example:8080", 5])
    with pytest.raises(BadStartError) as refused:
        parse_start(json.dumps(bad))
    assert "hunter2" not in str(refused.value)


def test_every_message_the_emitter_writes_matches_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.ready()
    emit.run(total=2, start_at=0)
    emit.keyword(index=0, total=2, keyword="ai agents", state="started")
    emit.keyword(index=0, total=2, keyword="ai agents", state="done", found=9, kept=4)
    emit.keyword(index=1, total=2, keyword="ai news", state="failed", error="YouTube said no.")
    emit.channel(
        keyword="ai agents",
        channel_id="UCabc_123-x",
        handle="@aitoolsweekly",
        name="AI Tools Weekly",
        subscribers=184000,
        median_views=None,
        country=None,
        outcome="kept",
    )
    emit.log("info", 'Searching "ai agents" — 12 channels')
    emit.end(state="failed", at=1, found=9, kept=4, error=("quota", "The YouTube quota ran out."))
    emit.end(state="done", at=2, found=9, kept=4)

    messages = [check_from_pipeline(line) for line in out.getvalue().splitlines(keepends=True)]
    assert [m["type"] for m in messages] == [
        "ready",
        "run",
        "keyword",
        "keyword",
        "keyword",
        "channel",
        "log",
        "end",
        "end",
    ]
    assert messages[0]["protocol"] == protocol.PROTOCOL
    assert messages[5]["channelId"] == "UCabc_123-x"
    assert "—" in out.getvalue()  # written as UTF-8, not \u escapes


def test_long_text_is_cut_to_fit_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.log("warn", "x" * 2000)
    emit.end(state="failed", at=0, found=0, kept=0, error=("crash", "y" * 2000))
    first, second = out.getvalue().splitlines(keepends=True)
    assert len(check_from_pipeline(first)["text"]) == protocol.MAX_TEXT
    assert len(check_from_pipeline(second)["error"]["message"]) == protocol.MAX_TEXT


def test_lines_from_many_threads_never_interleave(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)

    def write(n: int) -> None:
        for i in range(200):
            emit.log("info", f"worker {n} line {i} " + "z" * 300)

    threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    lines = out.getvalue().splitlines(keepends=True)
    assert len(lines) == 1600
    for line in lines:
        check_from_pipeline(line)


def wait_for_stop(stream: io.StringIO) -> bool:
    stopped = threading.Event()
    listen_for_stop(stream, stopped.set).join(timeout=5)
    return stopped.is_set()


def test_a_stop_line_stops_the_run() -> None:
    assert wait_for_stop(io.StringIO('not json\n{"type": "other"}\n{"type": "stop"}\n'))


def test_the_app_closing_stdin_stops_the_run() -> None:
    assert wait_for_stop(io.StringIO(""))


def test_the_network_is_blocked_in_tests() -> None:
    with pytest.raises(RuntimeError, match="network"):
        socket.create_connection(("www.youtube.com", 443))


# --- the jobs other than search (3e-3b) ---

AUTO_CLEAN: dict[str, Any] = START["job"]["rules"]["autoClean"]
SEND: dict[str, Any] = {
    "to": "sam@aitoolsweekly.com",
    "subject": "Your Claude Code series",
    "body": "Hi Sam,\n\nYour agents video was the clearest walk-through I have seen.",
    "sendKey": "reach:UCabc_123-x:first",
    "approvedBy": "owner@gratovo.com",
}

# Each kind with every optional field, and with none: both parse to themselves.
GOOD_JOBS: list[dict[str, Any]] = [
    {"kind": "mail.status"},
    {"kind": "mail.send", "message": SEND},
    {
        "kind": "mail.send",
        "message": {
            **SEND,
            "mailbox": "outreach@gratovo.com",
            "conversationKey": "UCabc_123-x",
            "newThread": True,
            "channelId": "UCabc_123-x",
            "labels": ["Gratovo", "AI creators"],
        },
    },
    {"kind": "mail.replies"},
    {
        "kind": "mail.replies",
        "mailbox": "outreach@gratovo.com",
        "conversationKey": "UCabc_123-x",
        "limit": 500,
    },
    {"kind": "mail.ack", "messageIds": ["18f2c3a9b7d4e001", "18f2c3a9b7d4e002"]},
    {"kind": "mail.cancel", "conversationKey": "UCabc_123-x"},
    {"kind": "video_stats", "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    {"kind": "refetch", "handles": ["@aitoolsweekly"], "autoClean": None},
    {
        "kind": "refetch",
        "handles": ["@aitoolsweekly", "@claude.daily", "@llm-news_today"],
        "keyword": "ai agents",
        "autoClean": AUTO_CLEAN,
    },
    {"kind": "backfill", "only": ["backlog"]},
    {
        "kind": "backfill",
        "only": ["channels", "videos", "backfill", "backlog"],
        "handles": ["@aitoolsweekly"],
        "months": 24,
        "maxApiCalls": 0,
        "includeAbsent": True,
        "limit": 100_000,
    },
    {"kind": "gateways.deploy", "regions": ["eu-west-1", "us-east-2", "ap-southeast-1"]},
    {"kind": "gateways.destroy", "gateways": [{"region": "eu-west-1", "apiId": "a1b2c3d4e5"}]},
    {"kind": "gateways.test"},
    {
        "kind": "import.legacy",
        "source": "D:\\old\\gratovo_code\\data\\database\\gratovo.db",
        "dryRun": False,
        "backupDir": "C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\backups",
    },
    # A dry run needs no backup folder; a POSIX path is what tmp_path gives on Linux.
    {
        "kind": "import.legacy",
        "source": "/home/runner/old/gratovo.db",
        "dryRun": True,
        "backupDir": None,
    },
]

# Two jobs of a kind (all fields, and the required ones only) get told apart by their place.
GOOD_IDS = [f"{job['kind']}-{i}" for i, job in enumerate(GOOD_JOBS)]


def live(job: object, base: dict[str, Any] = START) -> dict[str, Any]:
    """base running job on live data: only a search runs on example data."""
    return changed("source", "live", changed("job", job, base))


def test_every_kind_has_a_good_job() -> None:
    assert {job["kind"] for job in GOOD_JOBS} == set(protocol.RESULT_KINDS)


@pytest.mark.parametrize("job", GOOD_JOBS, ids=GOOD_IDS)
def test_a_good_job_of_each_kind_parses_to_the_same_values(
    job: dict[str, Any], protocol_schema: dict[str, Any]
) -> None:
    message = live(job)
    assert schema_errors(protocol_schema["toPipeline"], message) == []
    assert parse_start(json.dumps(message)) == message


# Each breaks the schema, so the JSON Schema refuses it too.
BAD_JOBS: list[dict[str, Any]] = [
    {"kind": "news"},
    {"kind": "mail.status", "mailbox": "outreach@gratovo.com"},
    {"kind": "mail.send"},
    {"kind": "mail.send", "message": {k: v for k, v in SEND.items() if k != "sendKey"}},
    {"kind": "mail.send", "message": {k: v for k, v in SEND.items() if k != "approvedBy"}},
    {"kind": "mail.send", "message": {**SEND, "sendKey": "short"}},
    {"kind": "mail.send", "message": {**SEND, "sendKey": "has spaces in it"}},
    {"kind": "mail.send", "message": {**SEND, "approvedBy": ""}},
    {"kind": "mail.send", "message": {**SEND, "to": "not an address"}},
    {"kind": "mail.send", "message": {**SEND, "to": "a@b.co,c@d.co"}},
    {"kind": "mail.send", "message": {**SEND, "body": ""}},
    {"kind": "mail.send", "message": {**SEND, "body": "x" * 100_001}},
    {"kind": "mail.send", "message": {**SEND, "subject": "x" * 999}},
    {"kind": "mail.send", "message": {**SEND, "subject": "Hi\nBcc: a@b.co"}},
    {"kind": "mail.send", "message": {**SEND, "subject": "Hi\r there"}},
    {"kind": "mail.send", "message": {**SEND, "subject": "Hi\u2028there"}},
    {"kind": "mail.send", "message": {**SEND, "subject": "Hi\x0bthere"}},
    {"kind": "mail.send", "message": {**SEND, "labels": ["a"] * 11}},
    {"kind": "mail.send", "message": {**SEND, "channelId": "../etc"}},
    {"kind": "mail.send", "message": {**SEND, "replyTo": "a@b.co"}},
    {"kind": "mail.replies", "limit": 0},
    {"kind": "mail.replies", "limit": 501},
    {"kind": "mail.replies", "limit": True},
    {"kind": "mail.replies", "mailbox": None},
    {"kind": "mail.ack", "messageIds": []},
    {"kind": "mail.ack", "messageIds": ["../inbox"]},
    {"kind": "mail.ack", "messageIds": ["a1"] * 501},
    {"kind": "mail.cancel"},
    {"kind": "mail.cancel", "conversationKey": "x" * 201},
    {"kind": "video_stats", "videoUrl": ""},
    {"kind": "video_stats", "videoUrl": "x" * 2001},
    {"kind": "refetch", "handles": [], "autoClean": None},
    {"kind": "refetch", "handles": ["aitoolsweekly"], "autoClean": None},
    {"kind": "refetch", "handles": ["@aitoolsweekly"]},
    {"kind": "refetch", "handles": ["@aitoolsweekly"], "autoClean": {"enabled": True}},
    {"kind": "refetch", "handles": ["@a"] * 2001, "autoClean": None},
    {"kind": "backfill", "only": []},
    {"kind": "backfill", "only": ["sync"]},
    {"kind": "backfill", "only": ["videos"], "months": 25},
    {"kind": "backfill", "only": ["videos"], "maxApiCalls": -1},
    {"kind": "backfill", "only": ["videos"], "handles": []},
    {"kind": "backfill", "only": ["videos"], "limit": 0},
    {"kind": "gateways.deploy", "regions": []},
    {"kind": "gateways.deploy", "regions": ["EU-WEST-1"]},
    {"kind": "gateways.deploy", "regions": ["eu-west-1.evil.example"]},
    {"kind": "gateways.deploy", "regions": ["eu-west-1"] * 21},
    {"kind": "gateways.destroy", "gateways": []},
    {"kind": "gateways.destroy", "gateways": [{"region": "eu-west-1", "apiId": "A1/B2"}]},
    {"kind": "gateways.destroy", "gateways": [{"region": "eu-west-1"}]},
    {"kind": "gateways.test", "regions": ["eu-west-1"]},
    {"kind": "import.legacy", "source": "gratovo.db", "dryRun": True, "backupDir": None},
    {"kind": "import.legacy", "source": "", "dryRun": True, "backupDir": None},
    {"kind": "import.legacy", "source": "C:\\" + "x" * 1022, "dryRun": True, "backupDir": None},
    {"kind": "import.legacy", "source": "C:\\old\\a\x00.db", "dryRun": True, "backupDir": None},
    {"kind": "import.legacy", "source": "C:\\old\\gratovo.db", "dryRun": True},
    {"kind": "import.legacy", "source": "C:\\old\\gratovo.db", "dryRun": "no", "backupDir": None},
    {"kind": "import.legacy", "source": "C:\\old\\gratovo.db", "dryRun": False, "backupDir": "bk"},
    {
        "kind": "import.legacy",
        "source": "C:\\old\\gratovo.db",
        "dryRun": True,
        "backupDir": None,
        "tables": ["channels"],
    },
]


@pytest.mark.parametrize("job", BAD_JOBS)
def test_a_job_that_breaks_the_schema_is_refused(
    job: dict[str, Any], protocol_schema: dict[str, Any]
) -> None:
    bad = live(job)
    assert schema_errors(protocol_schema["toPipeline"], bad) != []
    with pytest.raises(BadStartError):
        parse_start(json.dumps(bad))


# The checks JSON Schema can't express, which zod makes with refinements.
@pytest.mark.parametrize(
    "job",
    [
        {"kind": "refetch", "handles": ["@AIToolsWeekly", "@aitoolsweekly"], "autoClean": None},
        {"kind": "backfill", "only": ["videos", "videos"]},
        {"kind": "gateways.deploy", "regions": ["eu-west-1", "eu-west-1"]},
    ],
)
def test_a_job_that_breaks_a_refinement_is_refused(job: dict[str, Any]) -> None:
    with pytest.raises(BadStartError, match=r"unique|repeat"):
        parse_start(json.dumps(live(job)))


def test_a_real_import_without_a_backup_folder_is_refused() -> None:
    """A refinement in zod: a real import backs up pipeline.db first (plan D5)."""
    job = {"kind": "import.legacy", "source": "C:\\old\\gratovo.db", "dryRun": False}
    with pytest.raises(BadStartError, match="backupDir"):
        parse_start(json.dumps(live({**job, "backupDir": None})))


@pytest.mark.parametrize("job", GOOD_JOBS, ids=GOOD_IDS)
def test_only_a_search_runs_on_example_data(job: dict[str, Any]) -> None:
    with pytest.raises(BadStartError, match="example data"):
        parse_start(json.dumps(changed("job", job)))


def test_the_import_says_why_it_is_refused_on_example_data() -> None:
    job = {"kind": "import.legacy", "source": "C:\\old\\gratovo.db", "dryRun": True}
    with pytest.raises(BadStartError, match="the import is for live data"):
        parse_start(json.dumps(changed("job", {**job, "backupDir": None})))


# --- the median-views and uploads bounds (plan D8) ---


def test_a_start_from_before_step_4_has_no_bounds() -> None:
    """Both are optional: absent, they stay absent, and `.get` reads None (no bound)."""
    rules = parse_start(json.dumps(START))["job"]
    assert rules["kind"] == "search"
    assert rules["rules"].get("minMedianViews") is None
    assert rules["rules"].get("minUploads30") is None
    assert "minMedianViews" not in rules["rules"]


@pytest.mark.parametrize(
    ("median", "uploads"), [(None, None), (0, 0), (5_000, 4), (100_000_000, 10_000)]
)
def test_the_bounds_parse_to_themselves(
    median: int | None, uploads: int | None, protocol_schema: dict[str, Any]
) -> None:
    message = changed(
        "job.rules.minUploads30", uploads, changed("job.rules.minMedianViews", median)
    )
    assert schema_errors(protocol_schema["toPipeline"], message) == []
    assert parse_start(json.dumps(message)) == message


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("job.rules.minMedianViews", -1),
        ("job.rules.minMedianViews", 1.5),
        ("job.rules.minMedianViews", "5000"),
        ("job.rules.minMedianViews", True),
        ("job.rules.minMedianViews", 100_000_001),
        ("job.rules.minUploads30", -1),
        ("job.rules.minUploads30", 10_001),
        ("job.rules.minUploads30", False),
    ],
)
def test_a_bound_that_breaks_the_schema_is_refused(
    path: str, value: object, protocol_schema: dict[str, Any]
) -> None:
    bad = changed(path, value)
    assert schema_errors(protocol_schema["toPipeline"], bad) != []
    with pytest.raises(BadStartError):
        parse_start(json.dumps(bad))


def test_the_bounds_archive_with_the_old_app_s_labels() -> None:
    """The old rule archived every bound with its one label (auto_clean_controller.dart)."""
    assert protocol.AUTO_CLEAN_LABELS == ("haramStuff", "irrelevant", "inactive")
    assert protocol.AUTO_CLEAN_DEFAULT_LABEL in protocol.AUTO_CLEAN_LABELS
    assert START["job"]["rules"]["autoClean"]["label"] in protocol.AUTO_CLEAN_LABELS


MAIL_SETTINGS: dict[str, Any] = {
    "label": "Gratovo",
    "senderName": None,
    "mailboxes": [
        {"address": "outreach@gratovo.com", "dailyCap": 30, "warmupStartedOn": "2026-10-01"},
        {"address": "hello@gratovo.com", "dailyCap": 10, "warmupStartedOn": None},
    ],
}
MAIL_SECRETS: dict[str, Any] = {
    "client": {"id": "client-id.apps.example", "secret": "client-secret-not-real"},
    "mailboxes": [{"address": "outreach@gratovo.com", "refreshToken": "refresh-not-real"}],
}
AWS_KEYS: dict[str, Any] = {
    "accessKeyId": "AKIAEXAMPLEKEY0000",
    "secretAccessKey": "secret-access-key-not-real",
}


def changed_at(path: str, value: object, base: dict[str, Any]) -> dict[str, Any]:
    """changed(), where a number in the path is a list index (`a.0.b`)."""
    message = copy.deepcopy(base)
    *parents, last = path.split(".")
    node: Any = message
    for key in parents:
        node = node[int(key)] if key.isdigit() else node[key]
    node[last] = value
    return message


def with_mail() -> dict[str, Any]:
    message = live({"kind": "mail.status"})
    message = changed("settings.mail", MAIL_SETTINGS, message)
    message = changed("secrets.mail", MAIL_SECRETS, message)
    return changed("secrets.aws", AWS_KEYS, message)


def test_the_mail_settings_and_the_mail_and_aws_secrets_parse(
    protocol_schema: dict[str, Any],
) -> None:
    message = with_mail()
    assert schema_errors(protocol_schema["toPipeline"], message) == []
    assert parse_start(json.dumps(message)) == message


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("settings.mail.mailboxes.0.address", "other@gratovo.com"),
        ("settings.mail.mailboxes", []),
        ("secrets.mail.mailboxes.0.address", "unlisted@gratovo.com"),
    ],
)
def test_a_connected_mailbox_missing_from_the_settings_is_refused(path: str, value: object) -> None:
    """The address a line reports comes from the settings, never the secrets."""
    with pytest.raises(BadStartError, match="listed in settings"):
        parse_start(json.dumps(changed_at(path, value, with_mail())))


def test_a_connected_mailbox_is_matched_without_regard_to_case() -> None:
    message = changed_at("settings.mail.mailboxes.0.address", "Outreach@Gratovo.com", with_mail())
    assert parse_start(json.dumps(message)) == message


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("settings.mail.label", ""),
        ("settings.mail.senderName", "x" * 101),
        ("settings.mail.senderName", "Sam\nBcc: a@b.co"),
        ("settings.mail.mailboxes", [MAIL_SETTINGS["mailboxes"][0]] * 21),
        ("settings.mail.mailboxes.0.dailyCap", 51),
        ("settings.mail.mailboxes.0.dailyCap", 9),
        ("settings.mail.mailboxes.0.warmupStartedOn", "1 October"),
        ("settings.mail.mailboxes.0.address", "nobody"),
        ("secrets.mail.client", {"id": "client-id"}),
        ("secrets.mail.mailboxes.0.refreshToken", ""),
        ("secrets.aws.accessKeyId", "akia-lowercase"),
        ("secrets.aws.secretAccessKey", ""),
        ("secrets.aws.sessionToken", "x"),
    ],
)
def test_mail_settings_and_secrets_that_break_the_schema_are_refused(
    path: str, value: object, protocol_schema: dict[str, Any]
) -> None:
    bad = changed_at(path, value, with_mail())
    assert schema_errors(protocol_schema["toPipeline"], bad) != []
    with pytest.raises(BadStartError):
        parse_start(json.dumps(bad))


@pytest.mark.parametrize(
    ("path", "secret"),
    [
        ("secrets.aws.accessKeyId", "akia-the-real-key-id"),
        ("job.message.to", "sam-at-aitoolsweekly.com"),
        ("job.message.sendKey", "has a secret in it"),
    ],
)
def test_the_refusal_never_repeats_a_value(path: str, secret: str) -> None:
    bad = changed("job", {"kind": "mail.send", "message": dict(SEND)}, with_mail())
    bad = changed(path, secret, bad)
    with pytest.raises(BadStartError) as refused:
        parse_start(json.dumps(bad))
    assert secret not in str(refused.value)


# --- results and replies ---

ERROR: dict[str, Any] = {"code": "mail_auth", "message": "Google refused this mailbox's sign-in."}
RESULTS: list[tuple[protocol.ResultKind, dict[str, Any]]] = [
    (
        "mail.status",
        {
            "configured": True,
            "label": "Gratovo",
            "senderName": None,
            "accounts": [
                {
                    "account": "outreach@gratovo.com",
                    "connected": True,
                    "counters": {
                        "conversations": 12,
                        "sent": 14,
                        "awaitingReply": 9,
                        "replied": 3,
                        "pendingSteps": 0,
                        "dueSteps": 0,
                        "failedSteps": 0,
                        "unreportedReplies": 2,
                    },
                    "limits": {
                        "dailyCap": 30,
                        "warmupStartedOn": "2026-10-01",
                        "sentToday": 4,
                        "leftToday": 26,
                    },
                    "lastSweepAt": "2026-10-22T09:00:00Z",
                    "error": None,
                },
                {
                    "account": None,
                    "connected": False,
                    "counters": None,
                    "limits": None,
                    "lastSweepAt": None,
                    "error": ERROR,
                },
            ],
        },
    ),
    (
        "mail.send",
        {
            "duplicate": False,
            "account": "outreach@gratovo.com",
            "conversationKey": "UCabc_123-x",
            "messageId": "18f2c3a9b7d4e001",
            "threadId": None,
            "rfcMessageId": "<CAabc@mail.gmail.com>",
            "labelled": True,
            "threaded": False,
            "to": "sam@aitoolsweekly.com",
            "subject": "Your Claude Code series",
            "sentAt": "2026-10-22T09:00:00Z",
        },
    ),
    (
        "mail.replies",
        {
            "accounts": [
                {
                    "account": "outreach@gratovo.com",
                    "checked": 60,
                    "replies": 2,
                    "cancelledQueued": 1,
                    "error": None,
                },
                {
                    "account": "hello@gratovo.com",
                    "checked": 0,
                    "replies": 0,
                    "cancelledQueued": 0,
                    "error": {**ERROR, "code": "network"},
                },
            ]
        },
    ),
    ("mail.ack", {"acknowledged": 2}),
    ("mail.cancel", {"cancelled": 1, "closed": True}),
    ("video_stats", {"videoId": "dQw4w9WgXcQ", "views": 1_600_000_000, "fetchedAt": "2026-10-22"}),
    (
        "refetch",
        {"processed": 3, "swept": 1, "deferred": 0, "failedCount": 1, "failed": ["@gone"]},
    ),
    (
        "backfill",
        {
            "channels": {"targets": 4, "filled": 3},
            "videos": None,
            "backfill": {"channels": 2, "saved": 31},
            "backlog": {"stamped": 5},
            "apiCalls": 9,
            "budgetReached": False,
        },
    ),
    (
        "gateways.deploy",
        {
            "deployed": [
                {
                    "region": "eu-west-1",
                    "apiId": "a1b2c3d4e5",
                    "url": "https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com",
                }
            ],
            "failed": [{"region": "us-east-2", "message": "AWS refused the keys."}],
        },
    ),
    (
        "gateways.destroy",
        {
            "deleted": [{"region": "eu-west-1", "apiId": "a1b2c3d4e5"}],
            "failed": [{"region": "us-east-2", "apiId": "f6g7h8", "message": "AWS didn't answer."}],
        },
    ),
    (
        "gateways.test",
        {
            "results": [
                {"region": "eu-west-1", "status": 204, "ok": True, "message": None},
                {"region": None, "status": None, "ok": False, "message": "No answer."},
            ]
        },
    ),
    (
        "import.legacy",
        {
            "source": "D:\\old\\gratovo_code\\data\\database\\gratovo.db",
            "tables": [
                {"name": "channels", "inOld": 1840, "toAdd": 1812, "already": 28},
                {"name": "videos", "inOld": 0, "toAdd": 0, "already": 0},
            ],
            "skipped": [
                {"name": "influencers", "rows": 1790, "why": "synced"},
                {"name": "sync_state", "rows": 3, "why": "bookkeeping"},
                {"name": "news_items", "rows": 120, "why": "not-ported"},
            ],
            "unsent": {"outbox": 2, "activity": 0},
            "settingsFiles": [
                {"name": "run_config.json", "found": True},
                {"name": "settings.json", "found": False},
            ],
            "dryRun": False,
            "backup": "C:\\Users\\a\\backups\\pipeline-20261024T090000Z.db",
        },
    ),
]


def test_every_kind_has_a_result() -> None:
    assert [kind for kind, _ in RESULTS] == list(protocol.RESULT_KINDS)


@pytest.mark.parametrize(("kind", "data"), RESULTS, ids=[kind for kind, _ in RESULTS])
def test_each_result_matches_the_schema(
    kind: protocol.ResultKind, data: dict[str, Any], check_from_pipeline: Check
) -> None:
    out = io.StringIO()
    # The overloads pair each kind with its data; the table holds them all, so go round them.
    cast("Any", Emitter(out)).result(kind, data)
    message = check_from_pipeline(out.getvalue())
    assert message == {"type": "result", "kind": kind, "data": data}


def test_a_result_is_cut_to_fit_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.result(
        "gateways.deploy",
        {"deployed": [], "failed": [{"region": "eu-west-1", "message": "x" * 2000}]},
    )
    emit.result(
        "refetch",
        {
            "processed": 300,
            "swept": 0,
            "deferred": 0,
            "failedCount": 300,
            "failed": [f"@gone{i}" for i in range(300)],
        },
    )
    send = dict(RESULTS[1][1])
    send["rfcMessageId"] = "<" + "x" * 1000 + ">"
    emit.result("mail.send", cast("protocol.MailSendData", send))
    deploy, refetch, sent = (
        check_from_pipeline(line) for line in out.getvalue().splitlines(keepends=True)
    )
    assert len(deploy["data"]["failed"][0]["message"]) == protocol.MAX_TEXT
    assert len(refetch["data"]["failed"]) == protocol.MAX_FAILED_HANDLES
    assert refetch["data"]["failedCount"] == 300
    assert sent["data"]["rfcMessageId"] is None


def test_an_import_report_is_cut_to_its_bounds(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    report = cast("protocol.ImportReport", copy.deepcopy(RESULTS[-1][1]))
    report["tables"] = [
        {"name": f"t{i}" + "x" * 100, "inOld": i, "toAdd": 0, "already": i} for i in range(50)
    ]
    report["skipped"] = [{"name": f"s{i}", "rows": 1, "why": "not-ported"} for i in range(70)]
    report["settingsFiles"] = [{"name": f"f{i}.json", "found": False} for i in range(30)]
    Emitter(out).result("import.legacy", report)
    data = check_from_pipeline(out.getvalue())["data"]
    assert len(data["tables"]) == protocol.IMPORT_MAX_TABLES
    assert len(data["skipped"]) == protocol.IMPORT_MAX_SKIPPED
    assert len(data["settingsFiles"]) == protocol.IMPORT_MAX_SETTINGS_FILES
    assert {len(t["name"]) for t in data["tables"]} == {protocol.IMPORT_MAX_NAME}
    assert data["tables"][0]["inOld"] == 0
    assert report["tables"][0]["name"].startswith("t0x")  # the caller's report is left alone
    assert len(report["tables"][0]["name"]) > protocol.IMPORT_MAX_NAME


def test_a_progress_line_matches_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    emit = Emitter(out)
    emit.progress(table="channels", done=2, total=7)
    emit.progress(table="x" * 100, done=7, total=7)
    first, second = (check_from_pipeline(line) for line in out.getvalue().splitlines(True))
    assert first == {"type": "progress", "table": "channels", "done": 2, "total": 7}
    assert len(second["table"]) == protocol.IMPORT_MAX_NAME


def write_reply(out: io.StringIO, **changes: Any) -> None:
    fields: dict[str, Any] = {
        "account": "outreach@gratovo.com",
        "conversation_key": "UCabc_123-x",
        "channel_id": "UCabc_123-x",
        "message_id": "18f2c3a9b7d4e001",
        "sender": "sam@aitoolsweekly.com",
        "sender_name": "Sam from AI Tools Weekly",
        "subject": "Re: Your Claude Code series",
        "body": "Thanks! Send over the details and the rates.",
        "received_at": "2026-10-22T09:14:00Z",
        "is_first_reply": True,
        "cancelled_follow_ups": 1,
    }
    fields.update(changes)
    Emitter(out).reply(**fields)


def test_a_reply_matches_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    write_reply(out)
    message = check_from_pipeline(out.getvalue())
    assert message["type"] == "reply"
    assert message["from"] == "sam@aitoolsweekly.com"
    assert message["fromName"] == "Sam from AI Tools Weekly"
    assert message["body"] == "Thanks! Send over the details and the rates."
    assert message["bodyCut"] is False


def test_a_long_reply_body_is_cut_to_16000_characters(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    body = "".join(f"line {i} about our AI agents review. " for i in range(2500))[:70_000]
    write_reply(out, body=body)
    message = check_from_pipeline(out.getvalue())
    assert message["bodyCut"] is True
    assert message["body"] == body[: protocol.MAX_REPLY_BODY]


@pytest.mark.parametrize("unit", ['"\n', '"\n\x07', "\x00"], ids=["quotes", "controls", "nul"])
def test_a_body_that_escapes_past_the_line_limit_is_cut_until_it_fits(
    unit: str, check_from_pipeline: Check
) -> None:
    out = io.StringIO()
    body = unit * 30_000
    write_reply(out, body=body)
    line = out.getvalue()
    assert len(line.encode("utf-8")) <= protocol.MAX_LINE
    message = check_from_pipeline(line)
    assert message["bodyCut"] is True
    assert body.startswith(message["body"])
    assert 0 < len(message["body"]) <= protocol.MAX_REPLY_BODY


def test_a_reply_s_other_text_is_cut_to_the_schema(check_from_pipeline: Check) -> None:
    out = io.StringIO()
    write_reply(
        out,
        sender="x" * 400,
        sender_name="y" * 400,
        subject="z" * 2000,
        channel_id="not a channel id",
        received_at=None,
    )
    message = check_from_pipeline(out.getvalue())
    assert (len(message["from"]), len(message["fromName"]), len(message["subject"])) == (
        320,
        300,
        998,
    )
    assert message["channelId"] is None
    assert message["bodyCut"] is False


# --- the dispatcher and the entry point ---


@pytest.fixture
def base_network_rule() -> Iterator[None]:
    """Puts the network rule back to the search's after a test that ran the entry point."""
    yield
    net.allow_job_hosts("search")


JOB_MODULES: dict[str, str] = {
    "search": "search",
    "mail.status": "mail",
    "mail.send": "mail",
    "mail.replies": "mail",
    "mail.ack": "mail",
    "mail.cancel": "mail",
    "video_stats": "video_stats",
    "refetch": "refetch",
    "backfill": "backfill",
    "gateways.deploy": "gateways",
    "gateways.destroy": "gateways",
    "gateways.test": "gateways",
    "import.legacy": "import_legacy",
}


def start_for(job: dict[str, Any]) -> Start:
    return parse_start(json.dumps(START if job["kind"] == "search" else live(job)))


@pytest.mark.parametrize("job", [START["job"], *GOOD_JOBS], ids=["search", *GOOD_IDS])
def test_the_dispatcher_runs_the_module_of_each_kind(
    job: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    ran: list[str] = []
    for name in set(JOB_MODULES.values()):
        module = importlib.import_module(f"gratovo_pipeline.jobs.{name}")

        def record(_start: Start, _emitter: Emitter, *, name: str = name) -> None:
            ran.append(name)

        monkeypatch.setattr(module, "run", record)
    jobs.run(start_for(job), Emitter(io.StringIO()))
    assert ran == [JOB_MODULES[job["kind"]]]


def test_the_entry_point_opens_the_job_s_hosts_then_runs_it(
    monkeypatch: pytest.MonkeyPatch, base_network_rule: None
) -> None:
    seen: list[str] = []

    def record(start: Start, _emitter: Emitter) -> None:
        seen.append(start["job"]["kind"])
        net.check_url("https://gmail.googleapis.com/gmail/v1/users/me/profile")

    def no_listener(_stream: object, _on_stop: object) -> None:
        pass

    line = json.dumps(live({"kind": "mail.status"})) + "\n"
    monkeypatch.setattr(sys, "stdin", io.StringIO(line))
    monkeypatch.setattr(sys, "stdout", io.StringIO())
    monkeypatch.setattr(jobs, "run", record)
    monkeypatch.setattr(protocol, "listen_for_stop", no_listener)

    assert gratovo_main.main() == 0
    assert seen == ["mail.status"]
