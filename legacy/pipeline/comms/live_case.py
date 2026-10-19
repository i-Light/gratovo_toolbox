"""The live case: what the Comms queue hands the engine, built from gratovo.db (plan step 6).

    from comms import live_case
    case = live_case.build_case(conn, {"kind": "reply", "threadId": "..."}, moments=found)

A request names what to write -- `kind` (first | reply | followUp | decision) and who: a `threadId`, a creator's
`channelId`, or a `brandId` (with the `contactEmail` written to and, for a pitch, the `pitchChannelIds`). Optional:
`followUpNumber`, the Steer panel's corrections (`steer`: knob id -> option id, plus a free `note`), and `cashOffer`
(house choice HC-10, switched on for this case only).

The case reads the pipeline's tables (channels, videos) and the app's (channel_state, brands, deals, outreach_*,
agency_settings) in the one local file. Beside the engine's own fields it carries `policy` -- the facts the engine
refuses on before asking Gemini anything (HC-08 out of scope, HC-09 boycott, BRD-PRES-15 creators not ready). The
policy never reaches the prompt: `engine.case_prompt` sends CASE_FIELDS only.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date
from typing import Any, Optional

from . import checks, readiness

INCUBATOR_CLAIM = "We are part of a group of experienced agency owners who review our work."

# The old knob panel, now the Steer panel (decision old-files: the knobs stay as optional corrections). The engine
# reads English, so the note is written with these labels whatever language the app shows them in.
STEER = {
    "stage": ("What this message is", {"first": "a first email", "fu1": "follow-up 1", "fu2": "follow-up 2",
                                       "closing": "the last follow-up (closing)", "reply": "an answer to their reply",
                                       "reengage": "re-engaging an old lead"}),
    "channel": ("Channel", {"email": "email", "dm": "Instagram DM", "linkedin": "LinkedIn DM"}),
    "have": ("What we have", {"nothing": "nothing yet", "roster": "creators on our roster",
                              "brand": "a brand in hand", "deal": "a deal with a budget"}),
    "inmind": ("Brands in mind", {"none": "none", "yes": "yes, brands that fit them (not brands we work with)"}),
    "state": ("Their sponsors", {"unknown": "unknown", "unsponsored": "no sponsors lately", "some": "some sponsors",
                                 "full": "every video sponsored", "own": "they sell their own product"}),
    "pitch": ("What we are pitching", {"one": "one creator", "several": "several creators"}),
    "proof": ("Closed deals / case studies", {"none": "none yet", "some": "we have some"}),
    "btype": ("Brand type", {"active": "already runs influencer campaigns", "never": "never did influencer marketing",
                             "b2b": "B2B / SaaS / software", "apps": "apps / games", "ecom": "e-commerce / DTC",
                             "affiliate": "only does affiliate / gifting"}),
    "bsize": ("Brand size", {"small": "small (about 50 employees or fewer)", "big": "big"}),
    "creply": ("Their reply", {"interested": "interested", "which": "which brand? what are the details?",
                               "kit": "sent their media kit / analytics", "who": "who are you? send your website",
                               "budget": "what's the budget?", "affiliate": "affiliate only / wants a flat fee",
                               "gifting": "send me the product (gifting)", "manager": "my manager handles this",
                               "notint": "not interested", "silent": "replied, then went silent"}),
    "breply": ("Their reply", {"creators": "send creators / who do you have?", "budget": "states their budget or rates",
                               "cases": "asks for case studies", "notnow": "not now / maybe next month",
                               "ignored": "ignored our rate question", "kit": "asks for a media kit",
                               "affiliate": "we only do affiliate / gifting"}),
    "english": ("Their English", {"native": "native / fluent", "nonnative": "non-native"}),
}
READERS = {"creator": "influencer", "manager": "manager", "brand": "brand"}

# The channel's stage in the app, as the playbook names it for the creator side.
PIPELINE_TO_STAGE = {"negotiating": "negotiating", "contract": "contract", "awaitingDelivery": "production",
                     "paid": "after", "lost": "lost", "roster": "closed"}

GOALS = {
    "first_influencer": "First email to this creator: open a conversation about paid brand deals.",
    "reply": "Decide the next step after their latest message and draft our reply if one is needed.",
    "decision": "Decide the next step in this deal and draft the message it needs, if any.",
}


def _rows(conn, sql: str, params: tuple = ()) -> list:
    """The rows, or none when the app's tables are not in this file yet (a machine where the app never ran)."""
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return []


def _one(conn, sql: str, params: tuple = ()):
    rows = _rows(conn, sql, params)
    return rows[0] if rows else None


def _json(value: Any, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def _agency(conn) -> tuple[dict, dict]:
    """(what the engine may say about the agency, the boycott list)."""
    row = _one(conn, "SELECT body FROM agency_settings WHERE id = 'agency'")
    body = _json(row["body"] if row else None, {})
    claims = [c for c in body.get("true_claims") or [] if isinstance(c, str) and c.strip()]
    if body.get("incubator", True):   # HC-07 picked "incubator": true unless the owner turned it off
        claims.append(INCUBATOR_CLAIM)
    agency = {"name": body.get("name") or "[Agency]", "sender": body.get("sender") or "[Your name]",
              "what_we_do": body.get("what_we_do") or "A small influencer-marketing agency: we find brand "
                                                       "sponsorships for YouTube creators.",
              "true_claims": claims, "past_campaigns": body.get("past_campaigns") or [],
              "website": body.get("website") or None}
    boycott = body.get("boycott") if isinstance(body.get("boycott"), dict) else {}
    return agency, {"countries": [str(c).upper() for c in boycott.get("countries", ["IL"]) or []],
                    "brands": [str(b) for b in boycott.get("brands") or []]}


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _boycott(brand, boycott: dict) -> Optional[str]:
    """HC-09, the app's rule (lib/features/brands/application/boycott_check.dart): the country, or a listed name as
    the brand's name, one of its words, two of them run together, or its website."""
    country = (brand["country"] or "").strip().upper()
    if country and country in boycott["countries"]:
        return f"boycotted country {country}"
    words = [w.lower() for w in re.split(r"[^A-Za-z0-9]+", brand["name"] or "") if w]
    keys = {_key(brand["name"] or ""), *words, *(words[i] + words[i + 1] for i in range(len(words) - 1))}
    host = re.sub(r"^https?://", "", brand["website"] or "").split("/")[0].split(":")[0]
    labels = [p for p in host.split(".") if p]
    if len(labels) >= 2:
        keys.add(_key(labels[-2]))
    keys.discard("")
    for listed in boycott["brands"]:
        if _key(listed) and _key(listed) in keys:
            return f"on the boycott list ({listed})"
    return None


def _creator(conn, channel_id: str, moments: Optional[dict]) -> Optional[dict]:
    row = _one(conn, "SELECT channel_id, handle, name, subscribers, country, median_views_last_30, videos_last_30, "
                     "sponsored_ratio, seen_brands FROM channels WHERE channel_id = ?", (channel_id,))
    if row is None:
        return None
    subs = str(row["subscribers"] or "0").replace(",", "")
    facts: dict = {"channel": (row["name"] or row["handle"]).strip(), "handle": row["handle"], "platform": "YouTube",
                   "subscribers": int(subs) if subs.isdigit() else 0,
                   "median_views_last_30_days": int(row["median_views_last_30"] or 0),
                   "videos_last_30_days": row["videos_last_30"], "country": row["country"]}
    videos = _rows(conn, "SELECT video_id, title, view_count, published_at FROM videos WHERE channel_id = ? "
                         "AND title IS NOT NULL ORDER BY published_at DESC LIMIT 5", (channel_id,))
    facts["recent_videos"] = [v["title"] for v in videos]
    if videos:
        v = videos[0]
        latest = {"title": v["title"], "published": (v["published_at"] or "")[:10],
                  "views": int(str(v["view_count"] or "0").replace(",", "") or 0)}
        if moments and moments.get("video_id") == v["video_id"] and moments.get("moments"):
            latest["moments"] = moments["moments"]
        facts["latest_video"] = latest
    sponsors = [b for b in _json(row["seen_brands"], []) if isinstance(b, str) and re.search(r"[a-z]", b)]
    if sponsors:
        facts["sponsors_seen"] = sponsors
    if row["sponsored_ratio"] is not None:
        facts["share_of_recent_videos_sponsored"] = round(float(row["sponsored_ratio"]), 2)
    return facts


def _state(conn, channel_id: str):
    return _one(conn, "SELECT pipeline_stage, media_kit, creator_gender FROM channel_state WHERE channel_id = ?",
                (channel_id,))


def _audience(kit: dict) -> dict:
    out = {}
    if kit.get("countries"):
        out["top_countries"] = [{"code": c.get("code"), "pct": c.get("pct")} for c in kit["countries"]
                                if isinstance(c, dict)]
    for key, name in (("ageBand", "age_band"), ("engagement", "engagement_rate_pct")):
        if kit.get(key) not in (None, ""):
            out[name] = kit[key]
    return out


def _follow_ups_sent(thread: list[dict]) -> int:
    """Follow-ups already sent since their last reply: 0 right after the opening message. The same count as the
    app's `followUpsSent` (follow_up_cadence.dart), so a redo that does not pass the number asks for the right one."""
    trailing = 0
    for message in reversed(thread):
        if message["from"] != "us":
            break
        trailing += 1
    return max(trailing - 1, 0)


def _thread(conn, thread_id: Optional[str]) -> list[dict]:
    if not thread_id:
        return []
    return [{"from": "us" if m["direction"] == "outbound" else "them", "at": (m["at"] or "")[:10],
             "subject": m["subject"] or "", "body": m["body"] or ""}
            for m in _rows(conn, "SELECT direction, subject, body, at FROM outreach_messages WHERE thread_id = ? "
                                 "ORDER BY at ASC", (thread_id,))]


def _steer_note(steer: dict) -> str:
    lines = []
    for knob, (label, options) in STEER.items():
        value = steer.get(knob)
        if value in options:
            lines.append(f"- {label}: {options[value]}")
    note = str(steer.get("note") or "").strip()
    if note:
        lines.append(f"- {note}")
    return ("Corrections from the person sending this (they override what you read from the case):\n"
            + "\n".join(lines)) if lines else ""


def build_case(conn, request: dict, *, today: Optional[str] = None, moments: Optional[dict] = None) -> dict:
    kind = request.get("kind") or "reply"
    steer = request.get("steer") if isinstance(request.get("steer"), dict) else {}
    thread_row = None
    if request.get("threadId"):
        thread_row = _one(conn, "SELECT id, channel_id, brand_id, contact_email, deal_id FROM outreach_threads "
                                "WHERE id = ?", (request["threadId"],))
    channel_id = request.get("channelId") or (thread_row["channel_id"] if thread_row else None)
    brand_id = request.get("brandId") or (thread_row["brand_id"] if thread_row else None)
    thread_id = thread_row["id"] if thread_row else None
    if thread_id is None and (channel_id or brand_id):
        found = _one(conn, "SELECT id FROM outreach_threads WHERE channel_id = ? ORDER BY updated_at DESC LIMIT 1",
                     (channel_id,)) if channel_id and not brand_id else None
        thread_id = found["id"] if found else None
    thread = [] if kind == "first" else _thread(conn, thread_id)
    agency, boycott_list = _agency(conn)
    today = today or date.today().isoformat()
    facts: dict = {"today": today}
    policy: dict = {"creator_out_of_scope": False, "boycott": None, "not_ready": []}
    state = None

    if brand_id:
        side = "brand"
        brand = _one(conn, "SELECT * FROM brands WHERE id = ?", (brand_id,))
        contacts = _json(brand["contacts"] if brand else None, [])
        email = (request.get("contactEmail") or (thread_row["contact_email"] if thread_row else "") or "").lower()
        contact = next((c for c in contacts if isinstance(c, dict) and str(c.get("email") or "").lower() == email),
                       None) or next((c for c in contacts if isinstance(c, dict) and c.get("primary")), None)
        counterpart = {"kind": "brand", "company": brand["name"] if brand else "",
                       "name": (contact or {}).get("name") or (brand["contact_name"] if brand else "") or ""}
        if brand:
            facts["brand"] = {k: brand[k] for k in ("name", "website", "category", "country") if brand[k]}
            if brand["campaign_brief"]:
                facts["brand"]["brief"] = brand["campaign_brief"]
            policy["boycott"] = _boycott(brand, boycott_list)
        pitched = []
        for cid in request.get("pitchChannelIds") or []:
            creator = _creator(conn, cid, None)
            if creator is None:
                continue
            pitched_state = _state(conn, cid)
            kit = _json(pitched_state["media_kit"] if pitched_state else None, {})
            if kit:
                creator["audience"] = _audience(kit)
            pitched.append(creator)
            if readiness.missing(kit, pitched_state["creator_gender"] if pitched_state else None):
                policy["not_ready"].append(creator["handle"])
        if pitched:
            facts["creators"] = pitched
        handles = " and ".join(c["handle"] for c in pitched) or "our creators"
        goal = f"First email to this brand: pitch {handles}." if kind == "first" else None
    else:
        side = "influencer"
        state = _state(conn, channel_id) if channel_id else None
        creator = _creator(conn, channel_id, moments) if channel_id else None
        kit = _json(state["media_kit"] if state else None, {})
        if creator is not None:
            if kit:
                creator["audience"] = _audience(kit)
            facts["creator"] = creator
        policy["creator_out_of_scope"] = bool(state and state["creator_gender"] in readiness.OUT_OF_SCOPE)
        name = (creator or {}).get("channel") or channel_id or ""
        counterpart = {"kind": "creator", "name": name, "channel": name, "handle": (creator or {}).get("handle")}
        goal = GOALS["first_influencer"] if kind == "first" else None
        deal = _one(conn, "SELECT d.*, b.name AS brand_name FROM deals d LEFT JOIN brands b ON b.id = d.brand_id "
                          "WHERE d.channel_id = ? ORDER BY d.created_at DESC LIMIT 1", (channel_id,)) if channel_id else None
        if deal is not None:
            # Never the brand's price: the margin is the agency's (HC-04).
            facts["deal"] = {k: v for k, v in {
                "brand": deal["brand_name"], "stage": deal["stage"], "creator_receives": deal["influencer_payout"],
                "currency": deal["currency"], "deliverables": deal["deliverables"], "deadline": deal["deadline"],
                "payment_terms": deal["payment_terms"]}.items() if v not in (None, "")}

    # The Steer panel can say a creator's manager reads it (or that it is the creator after all); it cannot turn a
    # creator's thread into a brand's.
    reader = READERS.get(steer.get("reader") or "")
    if reader in ("influencer", "manager") and side in ("influencer", "manager"):
        side = reader
        counterpart["kind"] = "manager" if side == "manager" else "creator"

    if kind == "first":
        stage = "prospect"
    elif side != "brand" and state is not None and PIPELINE_TO_STAGE.get(state["pipeline_stage"] or ""):
        stage = PIPELINE_TO_STAGE[state["pipeline_stage"]]
    elif any(m["from"] == "them" for m in thread):
        stage = "replied"
    else:
        stage = "contacted" if thread else "prospect"
    if goal is None:
        if kind == "followUp":
            n = int(request.get("followUpNumber") or _follow_ups_sent(thread) + 1)
            goal = f"Write our follow-up {n} of 3: they have not replied yet."
        else:
            goal = GOALS.get(kind, GOALS["reply"])

    history = [r["body"] for r in _rows(
        conn, "SELECT body FROM outreach_messages WHERE direction = 'outbound' AND body IS NOT NULL "
              "AND (thread_id IS NULL OR thread_id != ?) ORDER BY at DESC LIMIT 20", (thread_id or "",))]
    case = {"side": side, "stage": stage, "goal": goal, "channel": STEER["channel"][1].get(steer.get("channel"), "email"),
            "counterpart": counterpart, "agency": agency, "recent_messages": history[:4], "facts": facts,
            "thread": thread, "house_choices": {"HC-10": "yes"} if request.get("cashOffer") else {},
            "employee_note": _steer_note(steer), "policy": policy}
    case["overused_phrases"] = checks.overused_phrases(history, case)
    return case
