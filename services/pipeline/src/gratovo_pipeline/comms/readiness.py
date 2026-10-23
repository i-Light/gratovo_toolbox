"""Whether a creator may go into a brand pitch (BRD-PRES-15, HC-27, HC-08) -- the same rule as the
app's `PitchReadiness` (lib/data/models/media_kit.dart), on the same stored media kit. Keep the two
in step."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, cast

# INF-QUAL-12: US, UK and Canada together, unless a brand says otherwise.
DEFAULT_BRAND_COUNTRIES = ("US", "GB", "CA")
# HC-27: about 30% is good; in tech 20%+ is fine -- and the agency's niche, AI, is tech.
SHARE_GOOD = 30
SHARE_TECH = 20
NICHE_IS_TECH = True

OUT_OF_SCOPE = ("female", "couple")


def _objects(value: object) -> list[dict[str, Any]]:
    """The objects in a JSON list (anything else in it, or a value that is not a list, is
    skipped)."""
    items = cast(list[object], value) if isinstance(value, list) else []
    return [cast(dict[str, Any], item) for item in items if isinstance(item, dict)]


def missing(
    kit: object, gender: str | None, brand_countries: Iterable[str] = DEFAULT_BRAND_COUNTRIES
) -> list[str]:
    """What stands between this creator and a pitch: "out of scope" alone (HC-08), else any of
    "analytics" (top countries and age band), "agreed rate", "audience" (too little in the brand's
    countries). Empty means ready."""
    if gender in OUT_OF_SCOPE:
        return ["out of scope"]
    media: dict[str, Any] = cast(dict[str, Any], kit) if isinstance(kit, dict) else {}
    countries = _objects(media.get("countries"))
    gaps: list[str] = []
    if not countries or not str(media.get("ageBand") or "").strip():
        gaps.append("analytics")
    if not any(r.get("agreed") is True for r in _objects(media.get("rates"))):
        gaps.append("agreed rate")
    if countries:
        targets = {c.upper() for c in brand_countries}
        share = sum(
            float(c.get("pct") or 0)
            for c in countries
            if str(c.get("code") or "").upper() in targets
        )
        if share < (SHARE_TECH if NICHE_IS_TECH else SHARE_GOOD):
            gaps.append("audience")
    return gaps
