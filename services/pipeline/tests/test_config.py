"""The run's configuration, built from the start line (ported from the old test_config_pacing,
test_country_filter and test_parallel's pacing cases). No file is read: everything arrives on stdin.
"""

from pathlib import Path

import pytest
from helpers import start_with

from gratovo_pipeline.config import FAST_PACING, NORMAL_PACING, Config, Delay

GATEWAYS = ["https://abc123.execute-api.eu-west-1.amazonaws.com/prod", "https://g2"]
PROXIES = ["http://1.1.1.1:8080", "http://user:pass@2.2.2.2:3128"]


def config(**changes: object) -> Config:
    """A Config from START with no settings unless the test sends some."""
    merged: dict[str, object] = {"settings": {}}
    merged.update(changes)
    return Config.from_start(start_with(**merged))


# --- what the run is ---


def test_the_job_comes_from_the_start_line() -> None:
    cfg = config()
    assert cfg.source == "example"
    assert cfg.data_dir == Path("C:\\Users\\a\\AppData\\Roaming\\Gratovo Toolbox\\example-pipeline")
    assert cfg.worker == "example"
    assert cfg.keywords == ("best ai video editor 2026", "claude code tutorial")
    assert cfg.start_at == 1
    assert cfg.handles_limit == 200
    assert cfg.sort_by == "upload_date"
    assert cfg.results_type == "video"
    assert cfg.youtube_key == "test-key"


def test_countries_become_a_set() -> None:
    assert config(job__rules__countries=["US", "GB", "CA"]).country_filter == {"US", "GB", "CA"}


def test_no_countries_means_any_country() -> None:
    assert config(job__rules__countries=[]).country_filter is None


# --- auto-clean ---


def test_auto_clean_carries_the_rule() -> None:
    rule = config().auto_clean
    assert rule is not None
    assert (rule.min_subscribers, rule.max_subscribers) == (50_000, 2_000_000)
    assert (rule.below_min, rule.above_max, rule.label) == ("sweep", "delay", "inactive")


def test_auto_clean_off_is_none() -> None:
    assert config(job__rules__autoClean__enabled=False).auto_clean is None


@pytest.mark.parametrize("label", ["haramStuff", "irrelevant", "inactive"])
def test_auto_clean_keeps_a_known_label(label: str) -> None:
    rule = config(job__rules__autoClean__label=label).auto_clean
    assert rule is not None
    assert rule.label == label


def test_auto_clean_turns_an_unknown_label_into_irrelevant() -> None:
    rule = config(job__rules__autoClean__label="spam").auto_clean
    assert rule is not None
    assert rule.label == "irrelevant"


# --- rotation, workers and pacing (the owner's rule: parallel on means the Normal speed) ---


def test_no_rotation_is_normal_and_one_worker() -> None:
    cfg = config(settings={"parallel": {"enabled": True, "maxWorkers": 4}})
    assert cfg.rotating_connections == 0
    assert cfg.parallel_workers == 1
    assert cfg.pacing == "normal"


def test_rotation_without_parallel_is_fast() -> None:
    cfg = config(secrets__gatewayUrls=GATEWAYS)
    assert cfg.rotating_connections == 2
    assert cfg.parallel_workers == 1
    assert cfg.pacing == "fast"


def test_parallel_on_uses_normal() -> None:
    cfg = config(
        secrets__gatewayUrls=GATEWAYS, settings={"parallel": {"enabled": True, "maxWorkers": 4}}
    )
    assert cfg.parallel_workers == 2
    assert cfg.pacing == "normal"


def test_parallel_on_with_one_connection_is_just_rotation() -> None:
    cfg = config(
        secrets__gatewayUrls=GATEWAYS[:1], settings={"parallel": {"enabled": True, "maxWorkers": 4}}
    )
    assert cfg.parallel_workers == 1
    assert cfg.pacing == "fast"


def test_workers_are_capped_by_max_workers() -> None:
    cfg = config(
        secrets__gatewayUrls=GATEWAYS,
        secrets__proxyUrls=PROXIES,
        settings={
            "parallel": {"enabled": True, "maxWorkers": 3},
            "proxies": {"enabled": True, "includeDirect": True},
        },
    )
    assert cfg.rotating_connections == 4
    assert cfg.parallel_workers == 3


def test_proxies_count_only_while_enabled() -> None:
    off = config(
        secrets__proxyUrls=PROXIES, settings={"proxies": {"enabled": False, "includeDirect": True}}
    )
    on = config(
        secrets__proxyUrls=PROXIES, settings={"proxies": {"enabled": True, "includeDirect": True}}
    )
    assert off.rotating_connections == 0
    assert on.rotating_connections == 2


def test_proxy_urls_with_no_switch_sent_are_on() -> None:
    cfg = config(secrets__proxyUrls=PROXIES)
    assert cfg.proxies_enabled
    assert cfg.rotating_connections == 2


def test_blank_proxy_and_gateway_urls_dont_count() -> None:
    cfg = config(secrets__proxyUrls=[" "], secrets__gatewayUrls=["  "])
    assert cfg.rotating_connections == 0


def test_an_explicit_pacing_wins() -> None:
    assert config(settings={"pacing": "fast"}).pacing == "fast"
    assert config(secrets__gatewayUrls=GATEWAYS, settings={"pacing": "normal"}).pacing == "normal"


# --- delays ---


def test_normal_pacing_reads_the_normal_profile() -> None:
    assert config().delay("jitter_delay") == NORMAL_PACING["jitter_delay"] == Delay(2.5, 6.0)


def test_fast_pacing_reads_the_fast_profile() -> None:
    cfg = config(secrets__gatewayUrls=GATEWAYS)
    assert cfg.delay("jitter_delay") == FAST_PACING["jitter_delay"] == Delay(0.5, 1.5)
    assert cfg.delay("ip_cooldown") == Delay(5.0, 15.0, chance=10)


def test_the_delays_outside_the_profiles_are_the_same_at_both_speeds() -> None:
    normal, fast = config(), config(secrets__gatewayUrls=GATEWAYS)
    assert (
        normal.delay("catchup_videos_delay")
        == fast.delay("catchup_videos_delay")
        == Delay(0.8, 2.0)
    )
    assert normal.delay("channel_sweep_break") == Delay(40.0, 100.0, every=30)


def test_the_owner_s_defaults_are_kept() -> None:
    cfg = config()
    assert cfg.backfill_batch_size == 25
    assert NORMAL_PACING["ip_cooldown"] == Delay(30.0, 70.5, chance=50)
    assert set(NORMAL_PACING) == set(FAST_PACING)


def test_describe_never_shows_a_secret() -> None:
    cfg = config(
        secrets__youtubeKey="AIza-secret-value",
        secrets__proxyUrls=["http://user:hunter2@2.2.2.2:3128"],
        secrets__gatewayUrls=GATEWAYS,
    )
    text = cfg.describe()
    assert "AIza-secret-value" not in text
    assert "hunter2" not in text
    assert "abc123" not in text
    assert "youtube key: set" in text


# --- the other jobs (plan D15) ---


def job_config(job: dict[str, object], **changes: object) -> Config:
    """A Config for a job other than search: those run on live data only."""
    return config(source="live", job=job, **changes)


def test_a_job_other_than_search_gets_neutral_search_fields() -> None:
    cfg = job_config({"kind": "mail.status"})
    assert cfg.source == "live"
    assert cfg.keywords == ()
    assert cfg.start_at == 0
    assert cfg.handles_limit == 200
    assert (cfg.sort_by, cfg.results_type) == ("upload_date", "video")
    assert cfg.country_filter is None
    assert cfg.auto_clean is None


def test_a_job_other_than_search_keeps_the_routes_pacing_and_key() -> None:
    cfg = job_config(
        {"kind": "backfill", "only": ["videos"]},
        secrets__gatewayUrls=GATEWAYS,
        settings={"parallel": {"enabled": False, "maxWorkers": 4}},
    )
    assert cfg.gateway_urls == tuple(GATEWAYS)
    assert cfg.rotating_connections == 2
    assert cfg.pacing == "fast"
    assert cfg.youtube_key == "test-key"


def test_a_refetch_brings_its_own_auto_clean_rule() -> None:
    clean = {
        "enabled": True,
        "minSubscribers": 10_000,
        "maxSubscribers": 5_000_000,
        "belowMin": "delay",
        "aboveMax": "sweep",
        "label": "irrelevant",
    }
    rule = job_config({"kind": "refetch", "handles": ["@aitoolsweekly"], "autoClean": clean})
    assert rule.auto_clean is not None
    assert (rule.auto_clean.min_subscribers, rule.auto_clean.max_subscribers) == (
        10_000,
        5_000_000,
    )
    assert (rule.auto_clean.below_min, rule.auto_clean.above_max) == ("delay", "sweep")
    assert rule.keywords == ()


@pytest.mark.parametrize(
    "clean",
    [
        None,
        {
            "enabled": False,
            "minSubscribers": 0,
            "maxSubscribers": 0,
            "belowMin": "off",
            "aboveMax": "off",
            "label": "inactive",
        },
    ],
)
def test_a_refetch_without_a_rule_or_with_it_off_cleans_nothing(clean: object) -> None:
    job = {"kind": "refetch", "handles": ["@aitoolsweekly"], "autoClean": clean}
    assert job_config(job).auto_clean is None
