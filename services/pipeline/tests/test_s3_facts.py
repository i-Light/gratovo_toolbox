"""Step S3 (L1 to L6): the extra facts the same API calls return, their rollups, schema v7 and the
search position."""

import io
import json
import sqlite3
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

import pytest

from gratovo_pipeline import store, youtube
from gratovo_pipeline.example import ExampleSource
from gratovo_pipeline.youtube import YouTubeApi

KEY = "example-key-not-real"


class Opener:
    """Answers every call with one item per requested id, and keeps what was asked."""

    def __init__(self, item: dict[str, Any]) -> None:
        self.item = item
        self.calls: list[tuple[str, list[str], str]] = []

    def __call__(self, request: Request, timeout: float) -> io.BytesIO:
        url = urlsplit(request.full_url)
        query = parse_qs(url.query)
        ids = query["id"][0].split(",")
        self.calls.append((url.path.rsplit("/", 1)[-1], ids, query["part"][0]))
        return io.BytesIO(json.dumps({"items": [{**self.item, "id": i} for i in ids]}).encode())


def make_api(opener: Opener) -> YouTubeApi:
    return YouTubeApi(KEY, opener=opener, sleep=lambda _s: None)


def read_videos(item: dict[str, Any], ids: list[str]) -> dict[str, dict[str, Any]]:
    return cast("dict[str, dict[str, Any]]", make_api(Opener(item)).videos(ids))


def read_channels(item: dict[str, Any], batch: dict[str, str]) -> dict[str, dict[str, Any]]:
    return cast("dict[str, dict[str, Any]]", make_api(Opener(item)).channels(batch))


FULL_VIDEO = {
    "snippet": {
        "title": "Agents, tested",
        "publishedAt": "2026-10-01T12:00:00Z",
        "defaultAudioLanguage": "en-US",
        "defaultLanguage": "en",
        "categoryId": "28",
        "liveBroadcastContent": "none",
    },
    "statistics": {"viewCount": "1000", "likeCount": "50", "commentCount": "7"},
    "contentDetails": {"duration": "PT1H2M3S", "caption": "true"},
    "status": {"madeForKids": False},
    "topicDetails": {
        "topicCategories": [
            "https://en.wikipedia.org/wiki/Technology",
            "https://en.wikipedia.org/wiki/Knowledge",
            "https://en.wikipedia.org/wiki/Artificial_intelligence",
            "https://en.wikipedia.org/wiki/Technology",
        ]
    },
    "paidProductPlacementDetails": {"hasPaidProductPlacement": True},
}

FULL_CHANNEL = {
    "snippet": {
        "title": "AI Tools Weekly",
        "customUrl": "@aitoolsweekly",
        "publishedAt": "2019-03-04T00:00:00Z",
        "defaultLanguage": "en-GB",
    },
    "statistics": {
        "viewCount": "9000000",
        "videoCount": "212",
        "subscriberCount": "48200",
        "hiddenSubscriberCount": False,
    },
    "topicDetails": {"topicCategories": ["https://en.wikipedia.org/wiki/Technology"]},
    "contentDetails": {"relatedPlaylists": {"uploads": "UUaitools"}},
    "status": {"madeForKids": False},
}


# --- L1: the same number of calls and units ---


def test_details_and_videos_cost_the_same_calls_and_units_as_before() -> None:
    # 120 channels and 120 videos took ceil(120 / 50) = 3 calls each, one unit a call, before.
    opener = Opener({})
    api = make_api(opener)
    for start in range(0, 120, youtube.BATCH_SIZE):
        api.channels({f"@c{i}": f"UC{i:03d}" for i in range(start, min(120, start + 50))})
        api.videos([f"v{i:03d}" for i in range(start, min(120, start + 50))])
    assert [(name, len(ids)) for name, ids, _ in opener.calls] == [
        ("channels", 50),
        ("videos", 50),
        ("channels", 50),
        ("videos", 50),
        ("channels", 20),
        ("videos", 20),
    ]
    assert len(opener.calls) == 6, "six calls, six units: parts do not change the cost"
    assert all(len(ids) <= youtube.BATCH_SIZE for _, ids, _ in opener.calls)
    assert {part for name, _, part in opener.calls if name == "videos"} == {youtube.VIDEO_PARTS}
    assert {part for name, _, part in opener.calls if name == "channels"} == {youtube.CHANNEL_PARTS}


def test_the_parts_are_the_ones_the_plan_names() -> None:
    assert set(youtube.VIDEO_PARTS.split(",")) == {
        "snippet",
        "statistics",
        "contentDetails",
        "topicDetails",
        "status",
        "paidProductPlacementDetails",
    }
    assert set(youtube.CHANNEL_PARTS.split(",")) == {
        "snippet",
        "statistics",
        "brandingSettings",
        "topicDetails",
        "contentDetails",
        "status",
    }


# --- L2 and L3: parsing ---


def test_every_new_video_field_is_read() -> None:
    info = read_videos(FULL_VIDEO, ["v1"])["v1"]
    assert info["AudioLanguage"] == "en-US"
    assert info["DefaultLanguage"] == "en"
    assert info["CategoryId"] == "28"
    assert info["LiveContent"] == "none"
    assert (info["LikeCount"], info["CommentCount"]) == ("50", "7")
    assert info["DurationS"] == 3723
    assert info["HasCaptions"] == 1
    assert info["MadeForKids"] == 0
    assert info["Topics"] == ["Technology", "Knowledge", "Artificial intelligence"]
    assert info["PaidPlacement"] == 1


def test_hidden_and_missing_video_values_are_none_not_zero() -> None:
    item = {
        "snippet": {},
        "statistics": {"viewCount": "10"},  # likes hidden, comments off
        "contentDetails": {"duration": "P0D", "caption": "false"},
    }
    info = read_videos(item, ["v1"])["v1"]
    assert info["LikeCount"] is None
    assert info["CommentCount"] is None
    assert info["DurationS"] is None
    assert info["HasCaptions"] == 0
    assert info["AudioLanguage"] is None
    assert info["MadeForKids"] is None
    assert info["PaidPlacement"] is None
    assert info["Topics"] == []


def test_every_new_channel_field_is_read() -> None:
    found = read_channels(FULL_CHANNEL, {"@aitoolsweekly": "UCa"})["@aitoolsweekly"]
    assert found["Total_Views"] == 9000000
    assert found["Video_Count"] == 212
    assert found["Subscribers_Hidden"] == 0
    assert found["Started_At"] == "2019-03-04T00:00:00Z"
    assert found["Default_Language"] == "en-GB"
    assert found["Topics"] == ["Technology"]
    assert found["Uploads_Playlist"] == "UUaitools"
    assert found["Made_For_Kids"] == 0


def test_a_hidden_subscriber_count_and_missing_channel_parts() -> None:
    item = {"snippet": {"title": "x"}, "statistics": {"hiddenSubscriberCount": True}}
    found = read_channels(item, {"@x": "UCx"})["@x"]
    assert found["Subscribers_Hidden"] == 1
    assert found["Subscribers"] == "Hidden"
    assert found["Total_Views"] is None
    assert found["Video_Count"] is None
    assert found["Topics"] == []
    assert found["Uploads_Playlist"] is None
    assert found["Made_For_Kids"] is None


@pytest.mark.parametrize(
    ("text", "seconds"),
    [
        ("PT1H2M3S", 3723),
        ("PT45S", 45),
        ("PT10M", 600),
        ("P1DT2H", 93600),
        ("P0D", None),
        ("PT0S", None),
        ("PT", None),
        ("P", None),
        ("", None),
        ("garbage", None),
        ("PT-5S", None),
        ("1:02:03", None),
        (None, None),
        (3723, None),
    ],
)
def test_a_duration_is_read_into_seconds(text: object, seconds: int | None) -> None:
    assert youtube.parse_duration(text) == seconds


def test_topic_names_come_from_the_last_path_segment() -> None:
    details = {
        "topicCategories": [
            "https://en.wikipedia.org/wiki/Video_game_culture",
            "https://en.wikipedia.org/wiki/Society/",
            "https://en.wikipedia.org/wiki/Caf%C3%A9",
            42,
        ]
    }
    assert youtube.topic_names(details) == ["Video game culture", "Society", "Café"]
    assert youtube.topic_names(None) == []
    assert youtube.topic_names({"topicCategories": "nope"}) == []


# --- helpers for the store ---


def add_channel(
    conn: sqlite3.Connection,
    channel_id: str = "UC1",
    *,
    language: str | None = None,
    topics: list[str] | None = None,
) -> str:
    assert store.record_channel_discovery(conn, f"@{channel_id}", channel_id, "ai agents")
    conn.execute(
        "UPDATE channels SET default_language=?, topics=?, "
        "videos_fetched_at='2026-10-31T00:00:00Z' WHERE channel_id=?",
        (language, None if topics is None else json.dumps(topics), channel_id),
    )
    conn.commit()
    return channel_id


def add_videos(conn: sqlite3.Connection, channel_id: str, rows: list[dict[str, Any]]) -> None:
    taken = conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
    for n, row in enumerate(rows, taken):
        values: dict[str, Any] = {
            "video_id": f"{channel_id}-{n:02d}",
            "channel_id": channel_id,
            "published_at": f"2026-10-{20 - n:02d}T10:00:00Z",
            "last_fetch_status": "success",
            **row,
        }
        conn.execute(
            f"INSERT INTO videos ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})",  # noqa: S608 - test columns
            list(values.values()),
        )
    conn.commit()


def rollup(conn: sqlite3.Connection, channel_id: str = "UC1") -> dict[str, Any]:
    store.compute_channel_rollups(conn, [channel_id])
    return dict(store.get_channel_row(conn, channel_id) or {})


# --- L4: the rollups ---


def test_main_language_is_the_audio_majority_by_primary_subtag(conn: sqlite3.Connection) -> None:
    add_channel(conn, language="de")
    add_videos(
        conn,
        "UC1",
        [{"audio_language": "en-US"}, {"audio_language": "en-GB"}, {"audio_language": "es"}, {}],
    )
    row = rollup(conn)
    assert (row["main_language"], row["main_language_basis"]) == ("en", "audio 2/4")


def test_audio_needs_at_least_half_of_the_videos_else_default_is_tried(
    conn: sqlite3.Connection,
) -> None:
    add_channel(conn, language="de")
    add_videos(
        conn,
        "UC1",
        [
            {"audio_language": "es", "default_language": "pt-BR"},
            {"default_language": "pt"},
            {"default_language": "pt"},
            {},
        ],
    )
    row = rollup(conn)
    assert (row["main_language"], row["main_language_basis"]) == ("pt", "default 3/4")


def test_exactly_half_with_an_audio_language_is_enough(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    add_videos(conn, "UC1", [{"audio_language": "es"}, {"audio_language": "es"}, {}, {}])
    row = rollup(conn)
    assert (row["main_language"], row["main_language_basis"]) == ("es", "audio 2/4")


def test_the_channels_own_language_is_the_last_resort(conn: sqlite3.Connection) -> None:
    add_channel(conn, language="hi-IN")
    add_videos(conn, "UC1", [{}, {}, {"audio_language": "en"}])  # 1 of 3: under half
    row = rollup(conn)
    assert (row["main_language"], row["main_language_basis"]) == ("hi", "channel")


def test_no_language_anywhere_is_null_and_undetermined_does_not_count(
    conn: sqlite3.Connection,
) -> None:
    add_channel(conn)
    add_videos(conn, "UC1", [{"audio_language": "und"}, {"audio_language": "zxx"}])
    row = rollup(conn)
    assert (row["main_language"], row["main_language_basis"]) == (None, None)


def test_a_language_tie_goes_to_the_newest_video(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    # Video 0 is the newest (the 20th).
    add_videos(conn, "UC1", [{"audio_language": "es"}, {"audio_language": "en"}])
    assert rollup(conn)["main_language"] == "es"
    conn.execute("UPDATE videos SET published_at='2026-09-01T00:00:00Z' WHERE video_id='UC1-00'")
    conn.commit()
    assert rollup(conn)["main_language"] == "en"


def test_topic_counts_add_the_channels_own_topics_once_each(conn: sqlite3.Connection) -> None:
    add_channel(conn, topics=["Technology", "Technology", "Society"])
    add_videos(
        conn,
        "UC1",
        [
            {"topics": json.dumps(["Technology", "Knowledge"])},
            {"topics": json.dumps(["Technology"])},
            {"topics": None},
        ],
    )
    counts = json.loads(rollup(conn)["topic_counts"])
    assert counts == {"Technology": 3, "Knowledge": 1, "Society": 1}
    assert next(iter(counts)) == "Technology"


def test_medians_of_likes_comments_and_duration(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    add_videos(
        conn,
        "UC1",
        [
            {"like_count": "10", "comment_count": "1", "duration_s": 30},
            {"like_count": "30", "comment_count": None, "duration_s": 600},
            {"like_count": "20", "comment_count": "5", "duration_s": 900},
            {"like_count": None, "comment_count": None, "duration_s": None},
        ],
    )
    row = rollup(conn)
    assert row["median_likes"] == 20
    assert row["median_comments"] == 3
    assert row["median_duration_s"] == 600


def test_engagement_is_null_under_three_usable_videos(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    usable = {"view_count": "100", "like_count": "8", "comment_count": "2"}
    add_videos(
        conn,
        "UC1",
        [
            usable,
            usable,
            {"view_count": "0", "like_count": "1", "comment_count": "1"},
            {"view_count": "100", "like_count": None, "comment_count": "2"},
        ],
    )
    assert rollup(conn)["engagement_rate"] is None, "only two videos qualify"
    add_videos(conn, "UC1", [{**usable, "like_count": "28"}])
    assert rollup(conn)["engagement_rate"] == pytest.approx(0.10), "the median of .10, .10, .30"


def test_shorts_share_counts_videos_of_sixty_seconds_or_less(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    add_videos(
        conn,
        "UC1",
        [{"duration_s": 60}, {"duration_s": 61}, {"duration_s": 20}, {"duration_s": 900}, {}],
    )
    assert rollup(conn)["shorts_share"] == pytest.approx(0.5), "2 of the 4 with a duration"


def test_paid_share_counts_over_videos_with_the_field_known(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    add_videos(
        conn, "UC1", [{"paid_placement": 1}, {"paid_placement": 0}, {"paid_placement": 0}, {}]
    )
    assert rollup(conn)["paid_share"] == pytest.approx(1 / 3)


def test_no_videos_means_null_rollups_and_unchanged_rows_are_not_rewritten(
    conn: sqlite3.Connection,
) -> None:
    add_channel(conn)
    row = rollup(conn)
    for column in (
        "main_language",
        "topic_counts",
        "median_likes",
        "engagement_rate",
        "median_duration_s",
        "shorts_share",
        "paid_share",
    ):
        assert row[column] is None, column
    add_videos(conn, "UC1", [{"audio_language": "en", "duration_s": 100}])
    assert store.compute_channel_rollups(conn, ["UC1"]) == 1
    assert store.compute_channel_rollups(conn, ["UC1"]) == 0, "nothing changed, nothing written"


def test_failed_video_rows_do_not_count_as_stored_videos(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    add_videos(
        conn,
        "UC1",
        [{"audio_language": "en"}, {"last_fetch_status": "failed", "published_at": None}],
    )
    assert rollup(conn)["main_language_basis"] == "audio 1/1"


# --- saving what the API returned ---


def test_the_new_fields_are_saved(conn: sqlite3.Connection) -> None:
    add_channel(conn)
    channel = read_channels(FULL_CHANNEL, {"@UC1": "UC1"})
    store.save_channels(conn, channel, {"@UC1": "UC1"})
    row = store.get_channel_row(conn, "UC1") or {}
    assert (row["total_views"], row["video_count"], row["subscribers_hidden"]) == (9000000, 212, 0)
    assert (row["started_at"], row["default_language"]) == ("2019-03-04T00:00:00Z", "en-GB")
    assert (row["uploads_playlist"], row["made_for_kids"]) == ("UUaitools", 0)
    assert json.loads(row["topics"]) == ["Technology"]

    videos = read_videos(FULL_VIDEO, ["v1"])
    store.save_videos(conn, videos, ["v1"], {"v1": "UC1"})
    video = dict(conn.execute("SELECT * FROM videos WHERE video_id='v1'").fetchone())
    assert (video["audio_language"], video["default_language"], video["category_id"]) == (
        "en-US",
        "en",
        "28",
    )
    assert (video["live_content"], video["like_count"], video["comment_count"]) == (
        "none",
        "50",
        "7",
    )
    assert (video["duration_s"], video["has_captions"], video["made_for_kids"]) == (3723, 1, 0)
    assert video["paid_placement"] == 1
    assert json.loads(video["topics"]) == ["Technology", "Knowledge", "Artificial intelligence"]


# --- L6: schema v7 and the blob ---

NEW_COLUMNS = {
    "videos": {
        "audio_language",
        "default_language",
        "category_id",
        "live_content",
        "like_count",
        "comment_count",
        "duration_s",
        "has_captions",
        "made_for_kids",
        "topics",
        "paid_placement",
    },
    "channels": {
        "total_views",
        "video_count",
        "subscribers_hidden",
        "started_at",
        "default_language",
        "topics",
        "uploads_playlist",
        "made_for_kids",
        "main_language",
        "main_language_basis",
        "topic_counts",
        "median_likes",
        "median_comments",
        "engagement_rate",
        "median_duration_s",
        "shorts_share",
        "paid_share",
    },
    "channel_keywords": {"position"},
}


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_a_version_6_file_gains_the_columns_and_keeps_every_row(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    old = store.get_connection(path)
    store.init_db(old)
    add_channel(old)
    add_videos(old, "UC1", [{"title": "kept"}])
    for table, added in store._V7_COLUMNS.items():  # pyright: ignore[reportPrivateUsage]
        for name, _kind in reversed(added):
            old.execute(f"ALTER TABLE {table} DROP COLUMN {name}")
    old.execute("PRAGMA user_version=6")
    old.commit()
    old.close()

    conn = store.get_connection(path)
    store.init_db(conn)
    store.init_db(conn)  # safe to run twice
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 7
    for table, names in NEW_COLUMNS.items():
        assert names <= columns(conn, table), table
    assert conn.execute("SELECT title FROM videos").fetchone()[0] == "kept"
    assert conn.execute("SELECT position FROM channel_keywords").fetchone()[0] is None
    conn.close()


def test_a_half_migrated_version_6_file_adds_only_what_is_missing(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.db"
    old = store.get_connection(path)
    store.init_db(old)
    old.execute("ALTER TABLE videos DROP COLUMN paid_placement")
    old.execute("PRAGMA user_version=6")
    old.commit()
    store.init_db(old)  # the other columns are already there
    assert "paid_placement" in columns(old, "videos")
    old.close()


def test_the_channel_blob_keeps_its_shape(conn: sqlite3.Connection) -> None:
    add_channel(conn, language="en")
    add_videos(
        conn,
        "UC1",
        [{"title": "t", "audio_language": "en", "like_count": "3", "duration_s": 100}],
    )
    rollup(conn)
    blob = store.build_channel_blob(conn, "UC1") or {}
    assert set(blob) == {"v", "channel", "videos", "failed_video_ids"}
    assert list(blob["channel"]) == [
        "channel_id",
        "handle",
        "name",
        "description",
        "subscribers",
        "profile_picture",
        "banner",
        "link",
        "country",
        "first_seen_at",
        "last_fetched_at",
        "videos_fetched_at",
    ]
    assert set(blob["videos"][0]) == {
        "video_id",
        "title",
        "description",
        "thumbnail",
        "tags",
        "published_at",
        "view_count",
        "last_fetched_at",
    }


# --- L5: the search position ---


def test_a_position_is_stored_on_a_new_link_only(conn: sqlite3.Connection) -> None:
    def position(channel_id: str, keyword: str) -> int | None:
        row = conn.execute(
            "SELECT position FROM channel_keywords WHERE channel_id=? AND keyword=?",
            (channel_id, keyword),
        ).fetchone()
        return row[0]

    store.record_channel_discovery(conn, "@a", "UCa", "ai agents", 3)
    store.record_channel_discovery(conn, "@b", "UCb", "ai agents", 9)
    store.record_keyword_links(conn, {"@a": "UCa", "@b": "UCb"}, "ai agents", {"UCa": 1, "UCb": 2})
    assert position("UCa", "ai agents") == 3, "an existing link keeps its first position"
    assert position("UCb", "ai agents") == 9

    store.record_keyword_links(conn, {"@a": "UCa", "@b": "UCb"}, "claude code", {"UCa": 4})
    assert position("UCa", "claude code") == 4, "a new link takes the position"
    assert position("UCb", "claude code") is None, "no position given, none stored"


def test_the_example_source_gives_positions_and_the_new_fields() -> None:
    source = ExampleSource()
    found = source.find_channels("ai agents", limit=10)
    assert sorted(found.positions.values()) == list(range(1, len(found.channels) + 1))
    everyone = {f"@h{n}": f"UCexampleAiCreator{n:06d}" for n in range(30)}
    details = cast("dict[str, dict[str, Any]]", source.channels(everyone))
    for info in details.values():
        assert info["Topics"]
        assert info["Total_Views"]
    languages = [i["Default_Language"] for i in details.values()]
    assert languages.count("en") > 20
    assert {"es", "pt", "hi"} <= set(languages)
    ids = [f"exv{n:03d}{k:02d}" for n in range(30) for k in range(12)]
    videos = cast("dict[str, dict[str, Any]]", source.videos(ids))
    assert videos
    assert all(v["DurationS"] and v["Topics"] for v in videos.values())
    assert any(v["PaidPlacement"] == 1 for v in videos.values())
    assert any(v["DurationS"] <= 60 for v in videos.values() if v["DurationS"])


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("en-US", "en"),
        ("iw", "he"),
        ("in", "id"),
        ("ji-x", "yi"),
        ("fil", None),
        ("yue", None),
        ("haw", None),
        ("und", None),
        ("zxx", None),
        ("", None),
        (None, None),
    ],
)
def testprimary_language_keeps_only_two_letter_subtags(code: object, expected: str | None) -> None:
    assert store.primary_language(code) == expected
