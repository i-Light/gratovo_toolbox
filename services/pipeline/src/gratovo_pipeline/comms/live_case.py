"""The live case: what the Comms queue hands the engine (plan step 6; 3e-3 plan D6, D10).

    from gratovo_pipeline.comms import live_case
    case = live_case.build_case(conn, {"kind": "reply", "threadId": "..."}, facts, moments=found)

A request names what to write -- `kind` (first | reply | followUp | decision) and who: a `threadId`,
a creator's `channelId`, or a `brandId` (with the `contactEmail` written to and, for a pitch, the
`pitchChannelIds`). Optional: `followUpNumber`, the Steer panel's corrections (`steer`: knob id ->
option id, plus a free `note`), and `cashOffer` (house choice HC-10, switched on for this case
only).

The pipeline never reads the app's database (plan D6). The app's side of the case -- the agency's
own facts, the thread, each creator's state, the brand, the channel's latest deal and our recent
sent messages -- comes from main as `facts` (main reads them from its own tables, step 6). Python
reads only what it owns: `channels` and `videos` in pipeline.db (`conn`). A facts field that is
missing or of the wrong type counts as absent, as a table that was not there did before; it never
raises.

Beside the engine's own fields the case carries `policy` -- the facts the engine refuses on before
asking Gemini anything (HC-08 out of scope, HC-09 boycott, BRD-PRES-15 creators not ready). The
policy never reaches the prompt: `engine.case_prompt` sends CASE_FIELDS only.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date
from typing import Any, cast

from . import checks, readiness

INCUBATOR_CLAIM = "We are part of a group of experienced agency owners who review our work."

# The old knob panel, now the Steer panel (decision old-files: the knobs stay as optional
# corrections). The engine reads English, so the note is written with these labels whatever
# language the app shows them in.
STEER: dict[str, tuple[str, dict[str, str]]] = {
    "stage": (
        "What this message is",
        {
            "first": "a first email",
            "fu1": "follow-up 1",
            "fu2": "follow-up 2",
            "closing": "the last follow-up (closing)",
            "reply": "an answer to their reply",
            "reengage": "re-engaging an old lead",
        },
    ),
    "channel": ("Channel", {"email": "email", "dm": "Instagram DM", "linkedin": "LinkedIn DM"}),
    "have": (
        "What we have",
        {
            "nothing": "nothing yet",
            "roster": "creators on our roster",
            "brand": "a brand in hand",
            "deal": "a deal with a budget",
        },
    ),
    "inmind": (
        "Brands in mind",
        {"none": "none", "yes": "yes, brands that fit them (not brands we work with)"},
    ),
    "state": (
        "Their sponsors",
        {
            "unknown": "unknown",
            "unsponsored": "no sponsors lately",
            "some": "some sponsors",
            "full": "every video sponsored",
            "own": "they sell their own product",
        },
    ),
    "pitch": ("What we are pitching", {"one": "one creator", "several": "several creators"}),
    "proof": ("Closed deals / case studies", {"none": "none yet", "some": "we have some"}),
    "btype": (
        "Brand type",
        {
            "active": "already runs influencer campaigns",
            "never": "never did influencer marketing",
            "b2b": "B2B / SaaS / software",
            "apps": "apps / games",
            "ecom": "e-commerce / DTC",
            "affiliate": "only does affiliate / gifting",
        },
    ),
    "bsize": ("Brand size", {"small": "small (about 50 employees or fewer)", "big": "big"}),
    "creply": (
        "Their reply",
        {
            "interested": "interested",
            "which": "which brand? what are the details?",
            "kit": "sent their media kit / analytics",
            "who": "who are you? send your website",
            "budget": "what's the budget?",
            "affiliate": "affiliate only / wants a flat fee",
            "gifting": "send me the product (gifting)",
            "manager": "my manager handles this",
            "notint": "not interested",
            "silent": "replied, then went silent",
        },
    ),
    "breply": (
        "Their reply",
        {
            "creators": "send creators / who do you have?",
            "budget": "states their budget or rates",
            "cases": "asks for case studies",
            "notnow": "not now / maybe next month",
            "ignored": "ignored our rate question",
            "kit": "asks for a media kit",
            "affiliate": "we only do affiliate / gifting",
        },
    ),
    "english": ("Their English", {"native": "native / fluent", "nonnative": "non-native"}),
}
READERS = {"creator": "influencer", "manager": "manager", "brand": "brand"}

# The channel's stage in the app, as the playbook names it for the creator side.
PIPELINE_TO_STAGE = {
    "negotiating": "negotiating",
    "contract": "contract",
    "awaitingDelivery": "production",
    "paid": "after",
    "lost": "lost",
    "roster": "closed",
}

GOALS = {
    "first_influencer": "First email to this creator: open a conversation about paid brand deals.",
    "reply": (
        "Decide the next step after their latest message and draft our reply if one is needed."
    ),
    "decision": "Decide the next step in this deal and draft the message it needs, if any.",
}

# The old query read the 20 newest outbound bodies for the templated check (`overused_phrases`).
HISTORY = 20


# --- plain values out of JSON-ish facts (the wrong type is absent) ----------------------------


def _dict(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _list(value: object) -> list[Any]:
    return cast("list[Any]", value) if isinstance(value, list) else []


def _objects(value: object) -> list[dict[str, Any]]:
    return [cast("dict[str, Any]", item) for item in _list(value) if isinstance(item, dict)]


def _s(value: object) -> str:
    """A text field, or "" when it is missing or not text (the old `row[...] or ""`)."""
    return value if isinstance(value, str) else ""


def _number(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return value


# --- pipeline.db (the only tables Python reads: channels and videos) --------------------------


def _rows(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    """The rows, or none when the table is not in this file (kept from the old shared file)."""
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return []


def _one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    rows = _rows(conn, sql, params)
    return rows[0] if rows else None


def _json(value: Any, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except TypeError, ValueError:
        return default


def _creator(
    conn: sqlite3.Connection, channel_id: str, moments: dict[str, Any] | None
) -> dict[str, Any] | None:
    row = _one(
        conn,
        "SELECT channel_id, handle, name, subscribers, country, median_views_last_30, "
        "videos_last_30, sponsored_ratio, seen_brands FROM channels WHERE channel_id = ?",
        (channel_id,),
    )
    if row is None:
        return None
    subs = str(row["subscribers"] or "0").replace(",", "")
    facts: dict[str, Any] = {
        "channel": (row["name"] or row["handle"]).strip(),
        "handle": row["handle"],
        "platform": "YouTube",
        "subscribers": int(subs) if subs.isdigit() else 0,
        "median_views_last_30_days": int(row["median_views_last_30"] or 0),
        "videos_last_30_days": row["videos_last_30"],
        "country": row["country"],
    }
    videos = _rows(
        conn,
        "SELECT video_id, title, view_count, published_at FROM videos WHERE channel_id = ? "
        "AND title IS NOT NULL ORDER BY published_at DESC LIMIT 5",
        (channel_id,),
    )
    facts["recent_videos"] = [v["title"] for v in videos]
    if videos:
        v = videos[0]
        latest: dict[str, Any] = {
            "title": v["title"],
            "published": (v["published_at"] or "")[:10],
            "views": int(str(v["view_count"] or "0").replace(",", "") or 0),
        }
        if moments and moments.get("video_id") == v["video_id"] and moments.get("moments"):
            latest["moments"] = moments["moments"]
        facts["latest_video"] = latest
    sponsors = [
        b
        for b in _list(_json(row["seen_brands"], []))
        if isinstance(b, str) and re.search(r"[a-z]", b)
    ]
    if sponsors:
        facts["sponsors_seen"] = sponsors
    if row["sponsored_ratio"] is not None:
        facts["share_of_recent_videos_sponsored"] = round(float(row["sponsored_ratio"]), 2)
    return facts


# --- main's facts (what the old code read from the app's tables) ------------------------------


def _agency(facts: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """(what the engine may say about the agency, the boycott list)."""
    body = _dict(facts.get("agency"))
    claims = [c for c in _list(body.get("trueClaims")) if isinstance(c, str) and c.strip()]
    incubator = body.get("incubator")
    # HC-07 picked "incubator": true unless the owner turned it off.
    if incubator if isinstance(incubator, bool) else True:
        claims.append(INCUBATOR_CLAIM)
    agency: dict[str, Any] = {
        "name": _s(body.get("name")) or "[Agency]",
        "sender": _s(body.get("sender")) or "[Your name]",
        "what_we_do": _s(body.get("whatWeDo"))
        or "A small influencer-marketing agency: we find brand sponsorships for YouTube creators.",
        "true_claims": claims,
        "past_campaigns": _list(body.get("pastCampaigns")),
        "website": _s(body.get("website")) or None,
    }
    boycott = _dict(body.get("boycott"))
    countries = boycott.get("countries")
    listed: list[Any] = cast("list[Any]", countries) if isinstance(countries, list) else ["IL"]
    return agency, {
        "countries": [c.upper() for c in listed if isinstance(c, str)],
        "brands": [b for b in _list(boycott.get("brands")) if isinstance(b, str)],
    }


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _boycott(brand: dict[str, Any], boycott: dict[str, list[str]]) -> str | None:
    """HC-09, the app's rule (lib/features/brands/application/boycott_check.dart): the country, or
    a listed name as the brand's name, one of its words, two of them run together, or its
    website."""
    country = _s(brand.get("country")).strip().upper()
    if country and country in boycott["countries"]:
        return f"boycotted country {country}"
    name = _s(brand.get("name"))
    words = [w.lower() for w in re.split(r"[^A-Za-z0-9]+", name) if w]
    keys = {_key(name), *words, *(words[i] + words[i + 1] for i in range(len(words) - 1))}
    host = re.sub(r"^https?://", "", _s(brand.get("website"))).split("/")[0].split(":")[0]
    labels = [p for p in host.split(".") if p]
    if len(labels) >= 2:
        keys.add(_key(labels[-2]))
    keys.discard("")
    for listed in boycott["brands"]:
        if _key(listed) and _key(listed) in keys:
            return f"on the boycott list ({listed})"
    return None


def _state(facts: dict[str, Any], channel_id: str) -> dict[str, Any] | None:
    """The creator's `channel_state` in the app, as main sent it; None when there is none."""
    found = _dict(facts.get("creators")).get(channel_id)
    return cast("dict[str, Any]", found) if isinstance(found, dict) else None


def _kit(state: dict[str, Any] | None) -> dict[str, Any]:
    return _dict((state or {}).get("mediaKit"))


def _gender(state: dict[str, Any] | None) -> str | None:
    return _s((state or {}).get("creatorGender")) or None


def _audience(kit: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if kit.get("countries"):
        out["top_countries"] = [
            {"code": c.get("code"), "pct": c.get("pct")} for c in _objects(kit["countries"])
        ]
    for key, name in (("ageBand", "age_band"), ("engagement", "engagement_rate_pct")):
        if kit.get(key) not in (None, ""):
            out[name] = kit[key]
    return out


def _follow_ups_sent(thread: list[dict[str, Any]]) -> int:
    """Follow-ups already sent since their last reply: 0 right after the opening message. The same
    count as the app's `followUpsSent` (follow_up_cadence.dart), so a redo that does not pass the
    number asks for the right one."""
    trailing = 0
    for message in reversed(thread):
        if message["from"] != "us":
            break
        trailing += 1
    return max(trailing - 1, 0)


def _messages(thread: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The thread's messages, oldest first (the old `ORDER BY at ASC`)."""
    messages = _objects((thread or {}).get("messages"))
    return sorted(messages, key=lambda m: _s(m.get("at")))


def _thread(thread: dict[str, Any] | None) -> list[dict[str, Any]]:
    return [
        {
            "from": "us" if m.get("direction") == "outbound" else "them",
            "at": _s(m.get("at"))[:10],
            "subject": _s(m.get("subject")),
            "body": _s(m.get("body")),
        }
        for m in _messages(thread)
    ]


def _deal(deal: dict[str, Any]) -> dict[str, Any]:
    # Never the brand's price: the margin is the agency's (HC-04). Only these fields are taken,
    # whatever else the deal carries.
    terms: dict[str, Any] = {
        "brand": _s(deal.get("brandName")),
        "stage": _s(deal.get("stage")),
        "creator_receives": _number(deal.get("creatorReceives")),
        "currency": _s(deal.get("currency")),
        "deliverables": _s(deal.get("deliverables")),
        "deadline": _s(deal.get("deadline")),
        "payment_terms": _s(deal.get("paymentTerms")),
    }
    return {k: v for k, v in terms.items() if v not in (None, "")}


def _steer_note(steer: dict[str, Any]) -> str:
    lines: list[str] = []
    for knob, (label, options) in STEER.items():
        value = steer.get(knob)
        if isinstance(value, str) and value in options:
            lines.append(f"- {label}: {options[value]}")
    note = _s(steer.get("note")).strip()
    if note:
        lines.append(f"- {note}")
    return (
        (
            "Corrections from the person sending this (they override what you read from the "
            "case):\n" + "\n".join(lines)
        )
        if lines
        else ""
    )


def build_case(
    conn: sqlite3.Connection,
    request: dict[str, Any],
    facts: dict[str, Any] | None,
    *,
    today: str | None = None,
    moments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The case for `request`: the app's side from `facts` (main's, plan D6), the creators'
    channels and videos from pipeline.db (`conn`)."""
    known = _dict(facts)
    kind = _s(request.get("kind")) or "reply"
    steer = _dict(request.get("steer"))
    # The thread main sent, used when it is the one asked for (the old lookup by `threadId`).
    sent_thread = _dict(known.get("thread")) or None
    asked_thread = _s(request.get("threadId"))
    thread_row = (
        sent_thread
        if asked_thread and sent_thread and sent_thread.get("id") == asked_thread
        else None
    )
    channel_id = _s(request.get("channelId")) or _s((thread_row or {}).get("channelId")) or None
    brand_id = _s(request.get("brandId")) or _s((thread_row or {}).get("brandId")) or None
    thread_source = thread_row
    # No thread asked for (or not found): the creator's latest thread, which main sends as
    # `facts.thread`, as the old code looked it up by the channel.
    if (
        thread_source is None
        and channel_id
        and not brand_id
        and sent_thread
        and sent_thread.get("channelId") == channel_id
    ):
        thread_source = sent_thread
    thread = [] if kind == "first" else _thread(thread_source)
    agency, boycott_list = _agency(known)
    today = today or date.today().isoformat()
    case_facts: dict[str, Any] = {"today": today}
    policy: dict[str, Any] = {"creator_out_of_scope": False, "boycott": None, "not_ready": []}
    state: dict[str, Any] | None = None
    goal: str | None

    if brand_id:
        side = "brand"
        found_brand = _dict(known.get("brand"))
        # The brand main sent, when it is this one (the old lookup by id).
        brand = found_brand if found_brand and found_brand.get("id") in (brand_id, None) else None
        contacts = _objects((brand or {}).get("contacts"))
        email = (
            _s(request.get("contactEmail")) or _s((thread_row or {}).get("contactEmail"))
        ).lower()
        contact = next((c for c in contacts if _s(c.get("email")).lower() == email), None) or next(
            (c for c in contacts if c.get("primary")), None
        )
        counterpart: dict[str, Any] = {
            "kind": "brand",
            "company": _s((brand or {}).get("name")),
            "name": _s((contact or {}).get("name")) or _s((brand or {}).get("contactName")),
        }
        if brand:
            case_facts["brand"] = {
                k: brand[k] for k in ("name", "website", "category", "country") if _s(brand.get(k))
            }
            if _s(brand.get("campaignBrief")):
                case_facts["brand"]["brief"] = brand["campaignBrief"]
            policy["boycott"] = _boycott(brand, boycott_list)
        pitched: list[dict[str, Any]] = []
        for cid in _list(request.get("pitchChannelIds")):
            if not isinstance(cid, str):
                continue
            creator = _creator(conn, cid, None)
            if creator is None:
                continue
            pitched_state = _state(known, cid)
            kit = _kit(pitched_state)
            if kit:
                creator["audience"] = _audience(kit)
            pitched.append(creator)
            if readiness.missing(kit, _gender(pitched_state)):
                policy["not_ready"].append(creator["handle"])
        if pitched:
            case_facts["creators"] = pitched
        handles = " and ".join(c["handle"] for c in pitched) or "our creators"
        goal = f"First email to this brand: pitch {handles}." if kind == "first" else None
    else:
        side = "influencer"
        state = _state(known, channel_id) if channel_id else None
        creator = _creator(conn, channel_id, moments) if channel_id else None
        kit = _kit(state)
        if creator is not None:
            if kit:
                creator["audience"] = _audience(kit)
            case_facts["creator"] = creator
        policy["creator_out_of_scope"] = _gender(state) in readiness.OUT_OF_SCOPE
        name = (creator or {}).get("channel") or channel_id or ""
        counterpart = {
            "kind": "creator",
            "name": name,
            "channel": name,
            "handle": (creator or {}).get("handle"),
        }
        goal = GOALS["first_influencer"] if kind == "first" else None
        deal = known.get("deal")
        if channel_id and isinstance(deal, dict):
            # The channel's latest deal, as main read it.
            case_facts["deal"] = _deal(cast("dict[str, Any]", deal))

    # The Steer panel can say a creator's manager reads it (or that it is the creator after all);
    # it cannot turn a creator's thread into a brand's.
    reader = READERS.get(_s(steer.get("reader")))
    if reader in ("influencer", "manager") and side in ("influencer", "manager"):
        side = reader
        counterpart["kind"] = "manager" if side == "manager" else "creator"

    pipeline_stage = _s((state or {}).get("pipelineStage"))
    if kind == "first":
        stage = "prospect"
    elif side != "brand" and state is not None and PIPELINE_TO_STAGE.get(pipeline_stage):
        stage = PIPELINE_TO_STAGE[pipeline_stage]
    elif any(m["from"] == "them" for m in thread):
        stage = "replied"
    else:
        stage = "contacted" if thread else "prospect"
    if goal is None:
        if kind == "followUp":
            asked = _number(request.get("followUpNumber"))
            n = int(asked or _follow_ups_sent(thread) + 1)
            goal = f"Write our follow-up {n} of 3: they have not replied yet."
        else:
            goal = GOALS.get(kind, GOALS["reply"])

    # Our recent sent bodies (main's, newest first), less this thread's own: they are not "other"
    # messages (the old query left the thread out).
    own = {_s(m.get("body")) for m in _messages(thread_source) if m.get("direction") == "outbound"}
    history = [
        b for b in _list(known.get("recentOutbound")) if isinstance(b, str) and b not in own
    ][:HISTORY]
    case: dict[str, Any] = {
        "side": side,
        "stage": stage,
        "goal": goal,
        "channel": STEER["channel"][1].get(_s(steer.get("channel")), "email"),
        "counterpart": counterpart,
        "agency": agency,
        "recent_messages": history[:4],
        "facts": case_facts,
        "thread": thread,
        "house_choices": {"HC-10": "yes"} if request.get("cashOffer") else {},
        "employee_note": _steer_note(steer),
        "policy": policy,
    }
    case["overused_phrases"] = checks.overused_phrases(history, case)
    return case
