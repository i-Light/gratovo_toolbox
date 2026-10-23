"""The coach (plan §7b step 1): a draft judged the way the course's coaches judge student emails on
the calls.

    python -m gratovo_pipeline.comms.coach calibrate OUT [--mined-dir DIR] [--only idx,idx]
        [--tabs 3] [--accounts 0,1]    # held-out roasts, live
    python -m gratovo_pipeline.comms.coach agreement OUT [--mined-dir DIR]
        # verdict agreement with the coaches; writes OUT/agreement.json
    python -m gratovo_pipeline.comms.coach judge RUN [--tabs 3] [--accounts 0,1]
        # every draft of a scenario run; RUN/coach/
    python -m gratovo_pipeline.comms.coach report RUN
        # the scenario run's quality by verdict
    python -m gratovo_pipeline.comms.coach compare RUN RUN ...
        # runs of the same cases side by side (the variants)

The coach is the gratovo-comms skill in coach-review mode (its SKILL.md), one review per fresh chat
at thinking high. Before its verdicts grade anything they are compared with the coaches' own: the
calibration set is 120 roasts from the calls (45 bad, 40 mixed, 35 good; none of them among the
skill's examples), each a student's email as read on the call, the situation, and the coach's
verdict and points (data: mined calls, so the emails are reconstructions of what was on screen,
`read_aloud` >= 0.4). The set lives with the mined calls on the owner's PC (`--mined-dir`, or
`GRATOVO_MINED_DIR`). Agreement is reported three ways: the exact verdict, bad against the rest
(would it get roasted?), good against the rest (would a coach send it?).

Nothing here sends an email: the coach only reads drafts.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import uuid
from pathlib import Path
from statistics import median
from typing import Any, cast

from gratovo_pipeline.comms import checks, engine, example_bank
from gratovo_pipeline.gemini.json_reply import extract_json

VERDICTS = ("good", "mixed", "bad")

PROMPT = """Use the gratovo-comms skill in COACH REVIEW mode (see its SKILL.md): judge the DRAFT below the way the course's coaches judge a student's email on the coaching calls. Read the reference files for this side and stage first. Answer ONLY with the coach-review JSON in one code block.

SIDE: {side}
STAGE: {stage}
SITUATION:
{situation}

DRAFT:
```
{draft}
```"""  # noqa: E501


# Version 2 (2026-10-16), after calibration cal-01 (exact 50%, bad-or-not 63%, good-or-not 75%): the
# coach called 77 of 114 emails bad where the coaches said 43; 15 of the 34 a coach praised got
# "bad", for the same style rules (FND-WRITE-21, -11, -08, -27) it raised everywhere. The skill
# defines bad as "breaks a must rule", and with 556 rules nearly every email breaks one somewhere;
# the coaches keep "bad" for the wrong move.
GUIDE = """HOW THE COACHES GRADE (from their own verdicts on the calls):
- good: the move is right for the situation and it would get a reply; a coach would send it, at most after changing a few words. A good draft can still get one or two small points.
- mixed: the move is right, but one or two things must change before it goes out (too long, a weak or salesy line, a vague or hard ask, a missing piece).
- bad: the move itself is wrong for the situation, or it is dishonest, needy, a fan letter or a copied template, or it would not get a reply: it needs a rewrite, not edits.
A must rule broken in one sentence that is easy to fix makes it mixed, not bad. Wording and style points alone (reading level, length, a clumsy phrase) make it mixed at most. If the draft was read out on a call and written down, ignore typos, punctuation, capitals, line breaks and placeholders like [Name]: judge what was said. Raise only the points a coach would raise, most important first."""  # noqa: E501

ANCHORS = """REAL COACH VERDICTS ON SIMILAR EMAILS (from the coaching calls; the emails are reconstructions of what was read out). Grade on the same scale:
{examples}"""  # noqa: E501


def prompt(side: str, stage: str, situation: str, draft: str, version: int = 1) -> str:
    """The review prompt; version 2 adds the grading guide and real coach verdicts on similar
    emails as anchors."""
    text = PROMPT.format(side=side, stage=stage, situation=situation.strip(), draft=draft.strip())
    if version < 2:
        return text
    found = example_bank.for_review(side, stage, f"{situation} {draft}")
    anchors = ("\n\n" + ANCHORS.format(examples=example_bank.render(found))) if found else ""
    head, rest = text.split("\n\n", 1)
    return f"{head}\n\n{GUIDE}{anchors}\n\n{rest}"


def situation_of(case: dict[str, Any]) -> str:
    """A scenario case told as the coach needs it: who, the facts, the thread (the draft is judged
    against these)."""
    keep = {k: case[k] for k in ("goal", "counterpart", "agency", "facts", "thread") if case.get(k)}
    return json.dumps(keep, ensure_ascii=False, indent=1)


def _obj(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _objs(value: object) -> list[Any]:
    return cast("list[Any]", value) if isinstance(value, list) else []


def parse(text: str) -> dict[str, Any] | None:
    data = extract_json(text or "", strict=False)
    if data is None or data.get("verdict") not in VERDICTS:
        return None
    points = _objs(data.get("points"))
    # version 2 sometimes writes its points as sentences, in the style of the coach verdicts it is
    # shown
    data["points"] = [
        p if isinstance(p, dict) else {"rule": None, "problem": str(p), "fix": ""}
        for p in points
        if isinstance(p, dict | str) and p
    ]
    return data


def _text(r: dict[str, Any]) -> str:
    return str(r.get("textRaw") or r.get("text") or "")


def review(
    gemini: engine.GeminiCaller,
    side: str,
    stage: str,
    situation: str,
    draft: str,
    *,
    skill: str = engine.SKILL,
    mode: str = "chat",
    tab_id: int | None = None,
    timeout_s: int = 600,
    thinking: str = "high",
    version: int = 1,
) -> dict[str, Any]:
    """One review in a fresh chat; asked once more for the JSON when the answer has none. Like the
    engine's, every prompt carries a ref and an answer under another prompt is refused
    (engine._ours)."""
    ref = uuid.uuid4().hex[:10]
    r = engine._send(  # pyright: ignore[reportPrivateUsage]
        gemini,
        prompt(side, stage, situation, draft, version),
        new_chat=True,
        skill=skill,
        mode=mode,
        tab_id=tab_id,
        timeout_s=timeout_s,
        thinking=thinking,
        ref=ref,
    )
    raw = [_text(r)]
    data = parse(raw[0])
    if data is None:
        r = engine._send(  # pyright: ignore[reportPrivateUsage]
            gemini,
            "Answer again with ONLY the coach-review JSON (verdict, points, summary), in one code "
            "block.",
            new_chat=False,
            skill=None,
            mode="",
            tab_id=tab_id,
            timeout_s=timeout_s,
            thinking=thinking,
            ref=ref,
        )
        raw.append(_text(r))
        data = parse(raw[-1])
    return {
        "review": data,
        "raw": raw,
        "model": r.get("model"),
        "thinking": r.get("thinking"),
        "version": version,
    }


# --- calibration ---------------------------------------------------------------------------------


def calibration_path(mined_dir: Path | None = None) -> Path:
    """The calibration roasts: in `mined_dir`, else the folder `GRATOVO_MINED_DIR` names. They are
    made from the course and live with it on the owner's PC; there is no default."""
    path = (
        mined_dir / example_bank.CALIBRATION_NAME
        if mined_dir is not None
        else example_bank.calibration_file()
    )
    if path is None or not path.exists():
        raise FileNotFoundError(
            f"the coach's calibration roasts ({example_bank.CALIBRATION_NAME}) are not on this "
            f"computer: pass their folder with --mined-dir or set {example_bank.MINED_DIR_ENV}"
        )
    return path


def calibration_items(path: Path | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = json.loads(
        (path or calibration_path()).read_text(encoding="utf-8")
    )
    return items


def agreement(out_dir: Path, path: Path | None = None) -> dict[str, Any]:
    """The coach's verdicts against the coaches' on the calibration set: exact, bad-or-not,
    good-or-not, and the confusion table (rows: the coaches, columns: ours)."""
    out_dir = Path(out_dir)
    rows: list[dict[str, Any]] = []
    for item in calibration_items(path):
        p = out_dir / "answers" / f"cal-{item['idx']}.json"
        if not p.exists():
            continue
        review_ = _obj(_answer_result(p).get("review"))
        rows.append(
            {
                "idx": item["idx"],
                "stage": item["stage"],
                "coach": item["verdict"],
                "ours": review_.get("verdict"),
            }
        )
    # a review that came back without a verdict is a failed send (an empty answer), not a
    # disagreement
    failed = [r["idx"] for r in rows if r["ours"] not in VERDICTS]
    rows = [r for r in rows if r["ours"] in VERDICTS]
    n = len(rows)
    if not n:
        return {"reviewed": 0, "no_verdict": failed}
    exact = sum(r["coach"] == r["ours"] for r in rows)
    bad = sum((r["coach"] == "bad") == (r["ours"] == "bad") for r in rows)
    good = sum((r["coach"] == "good") == (r["ours"] == "good") for r in rows)
    table = {
        c: {o: sum(r["coach"] == c and r["ours"] == o for r in rows) for o in (*VERDICTS, None)}
        for c in VERDICTS
    }
    report_ = {
        "reviewed": n,
        "exact": round(100 * exact / n, 1),
        "bad_or_not": round(100 * bad / n, 1),
        "good_or_not": round(100 * good / n, 1),
        "table": {c: {str(o): k for o, k in t.items()} for c, t in table.items()},
        "no_verdict": failed,
        "rows": rows,
    }
    (out_dir / "agreement.json").write_text(
        json.dumps(report_, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return report_


def calibrate(
    out_dir: Path,
    only: set[str] | None = None,
    tabs: int = 3,
    gap_s: float = 60,
    timeout_s: int = 600,
    accounts: list[int] | None = None,
    version: int = 1,
    calibration: Path | None = None,
) -> dict[str, Any]:
    from gratovo_pipeline.comms import pool  # late: imports the bridge

    items = {
        f"cal-{it['idx']}": it
        for it in calibration_items(calibration)
        if not only or str(it["idx"]) in only
    }
    prompts = {
        k: prompt(it["side"], it["stage"], it["situation"] or "", it["student_email"], version)
        for k, it in items.items()
    }

    def job(key: str, client: pool.TabClient) -> dict[str, Any]:
        it = items[key]
        return review(
            client,
            it["side"],
            it["stage"],
            it["situation"] or "",
            it["student_email"],
            timeout_s=timeout_s,
            version=version,
        )

    stats = pool.run(
        prompts,
        Path(out_dir),
        tabs=tabs,
        gap_s=gap_s,
        timeout_s=timeout_s,
        job=job,
        title="Coach calibration",
        accounts=accounts,
    )
    report_ = agreement(Path(out_dir), calibration)
    pool.toast(
        "Coach calibration",
        f"{report_.get('reviewed')} reviewed: exact {report_.get('exact')}%, "
        f"bad-or-not {report_.get('bad_or_not')}%",
    )
    return {"pool": stats, "agreement": {k: v for k, v in report_.items() if k != "rows"}}


# --- judging a scenario run ----------------------------------------------------------------------


def _answer_result(path: Path) -> dict[str, Any]:
    return _obj(_obj(json.loads(path.read_text(encoding="utf-8"))).get("result"))


def drafts(run_dir: Path) -> dict[str, tuple[dict[str, Any], str]]:
    """{case id: (entry, body)} for every case of a scenario run whose answer carries a message."""
    run_dir = Path(run_dir)
    out: dict[str, tuple[dict[str, Any], str]] = {}
    for entry in json.loads((run_dir / "cases.json").read_text(encoding="utf-8")):
        p = run_dir / "answers" / f"{entry['id']}.json"
        if not p.exists():
            continue
        msg = _obj(_obj(_answer_result(p).get("proposal")).get("message"))
        if str(msg.get("body") or "").strip():
            subject = f"Subject: {msg['subject']}\n\n" if msg.get("subject") else ""
            out[entry["id"]] = (entry, subject + msg["body"])
    return out


def judge(
    run_dir: Path,
    tabs: int = 3,
    gap_s: float = 60,
    timeout_s: int = 600,
    accounts: list[int] | None = None,
    skip: set[str] | None = None,
    version: int = 1,
    out: str = "coach",
) -> dict[str, Any]:
    """Every draft of the run, in a fresh chat each; `skip`: case ids not to judge (e.g. answers
    known to be misfiled)."""
    from gratovo_pipeline.comms import pool  # late: imports the bridge

    found = {k: v for k, v in drafts(run_dir).items() if k not in (skip or set())}

    def args(entry: dict[str, Any], body: str) -> tuple[str, str, str, str]:
        case = entry["case"]
        return case["side"], case.get("stage") or "", situation_of(case), body

    prompts = {k: prompt(*args(e, b), version) for k, (e, b) in found.items()}

    def job(key: str, client: pool.TabClient) -> dict[str, Any]:
        return review(client, *args(*found[key]), timeout_s=timeout_s, version=version)

    stats = pool.run(
        prompts,
        Path(run_dir) / out,
        tabs=tabs,
        gap_s=gap_s,
        timeout_s=timeout_s,
        job=job,
        title="Coach review",
        accounts=accounts,
    )
    rep = report(run_dir, out)
    pool.toast("Coach review", f"{rep['counts']}")
    return {"pool": stats, "report": {k: v for k, v in rep.items() if k != "cases"}}


def report(run_dir: Path, out: str = "coach") -> dict[str, Any]:
    """The run's verdicts from `RUN/<out>` (coach, or coach-v2 for a second coach version)."""
    run_dir = Path(run_dir)
    cases: list[dict[str, Any]] = []
    counts = dict.fromkeys((*VERDICTS, "none"), 0)
    for key in sorted(drafts(run_dir)):
        p = run_dir / out / "answers" / f"{key}.json"
        r = _obj(_answer_result(p).get("review")) if p.exists() else {}
        v = r.get("verdict") or "none"
        counts[v] += 1
        cases.append(
            {
                "id": key,
                "verdict": v,
                "summary": r.get("summary"),
                "points": [
                    f"{_obj(x).get('rule')}: {_obj(x).get('problem')}"
                    for x in _objs(r.get("points"))
                ],
            }
        )
    rep = {"counts": counts, "cases": cases}
    (run_dir / out / "report.json").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / out / "report.json").write_text(
        json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return rep


def compare(run_dirs: list[Path], coach_dir: str = "coach") -> dict[str, Any]:
    """Scenario runs of the same cases side by side (plan §7b: the variants): per run the coach's
    verdicts on the cases every run answered with a message, the mechanical grade, the median
    length against the target, and how much its first emails share one frame (the most four-word
    runs any two of them share, names set aside, as in checks.TEMPLATED); then each case's verdicts
    in a row."""
    from gratovo_pipeline.comms import scenarios

    runs = [Path(r) for r in run_dirs]
    found = {r: drafts(r) for r in runs}
    in_all: set[str] | None = None
    for each in found.values():
        in_all = set(each) if in_all is None else in_all & set(each)
    common = sorted(in_all or set())
    verdicts: dict[Path, dict[str, str]] = {}
    for r in runs:
        verdicts[r] = {}
        for k in common:
            p = r / coach_dir / "answers" / f"{k}.json"
            got = _obj(_answer_result(p).get("review")) if p.exists() else {}
            verdicts[r][k] = got.get("verdict") or "none"
    out: dict[str, Any] = {
        "cases": len(common),
        "runs": {},
        "by_case": {k: {r.name: verdicts[r][k] for r in runs} for k in common},
    }
    for r in runs:
        grade = scenarios.grade(r)["summary"]
        ratio: list[float] = []
        frames: list[int] = []
        firsts: list[set[str]] = []
        for k in common:
            entry, text = found[r][k]
            # drafts() adds the subject line
            body = (
                text.split("\n\n", 1)[1]
                if text.startswith("Subject: ") and "\n\n" in text
                else text
            )
            target, _ = engine.target_words(entry["case"])
            ratio.append(len(body.split()) / target)
            if entry["kind"] == "first":
                firsts.append(
                    checks._shingles(  # pyright: ignore[reportPrivateUsage]
                        checks._skeleton(body, entry["case"]),  # pyright: ignore[reportPrivateUsage]
                        4,
                    )
                )
        for i in range(len(firsts)):
            for j in range(i + 1, len(firsts)):
                frames.append(len(firsts[i] & firsts[j]))
        counts = {v: sum(verdicts[r][k] == v for k in common) for v in (*VERDICTS, "none")}
        out["runs"][r.name] = {
            "coach": counts,
            "good_pct": round(100 * counts["good"] / max(len(common), 1)),
            "mechanics": f"{grade['passed']}/{grade['cases']}",
            "key_rules": grade.get("key_rules"),
            "length_vs_target_median": round(median(ratio), 2) if ratio else None,
            "first_email_frame_max": max(frames) if frames else None,
        }
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gratovo_pipeline.comms.coach")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("calibrate", "judge"):
        p = sub.add_parser(name)
        p.add_argument("out", type=Path)
        p.add_argument("--tabs", type=int, default=3)
        p.add_argument("--gap", type=float, default=60)
        p.add_argument("--accounts", default="")
        p.add_argument(
            "--version",
            type=int,
            default=1,
            help="coach version: 1, or 2 (grading guide + real verdicts as anchors)",
        )
        if name == "calibrate":
            p.add_argument("--only", default="")
            p.add_argument(
                "--mined-dir",
                type=Path,
                default=None,
                help=f"the mined calls' folder (else {example_bank.MINED_DIR_ENV})",
            )
        else:
            p.add_argument("--skip", default="", help="case ids not to judge, comma-separated")
    p = sub.add_parser("agreement")
    p.add_argument("out", type=Path)
    p.add_argument(
        "--mined-dir",
        type=Path,
        default=None,
        help=f"the mined calls' folder (else {example_bank.MINED_DIR_ENV})",
    )
    sub.add_parser("report").add_argument("out", type=Path)
    p = sub.add_parser("compare")
    p.add_argument("runs", type=Path, nargs="+")
    p.add_argument("--coach-dir", default="coach", help="coach (version 1) or coach-v2")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="replace")
    accounts = [int(x) for x in getattr(args, "accounts", "").split(",") if x.strip()] or None
    calibration: Path | None = None
    if args.cmd in ("calibrate", "agreement"):
        try:
            calibration = calibration_path(args.mined_dir)
        except FileNotFoundError as error:
            print(error, file=sys.stderr)
            return 2
    if args.cmd == "calibrate":
        only = {x.strip() for x in args.only.split(",") if x.strip()} or None
        print(
            json.dumps(
                calibrate(
                    args.out,
                    only=only,
                    tabs=args.tabs,
                    gap_s=args.gap,
                    accounts=accounts,
                    version=args.version,
                    calibration=calibration,
                ),
                indent=1,
            )
        )
    elif args.cmd == "compare":
        print(json.dumps(compare(args.runs, args.coach_dir), ensure_ascii=False, indent=1))
    elif args.cmd == "judge":
        skip = {x.strip() for x in args.skip.split(",") if x.strip()}
        print(
            json.dumps(
                judge(
                    args.out,
                    tabs=args.tabs,
                    gap_s=args.gap,
                    accounts=accounts,
                    skip=skip,
                    version=args.version,
                    out="coach" if args.version == 1 else f"coach-v{args.version}",
                ),
                indent=1,
            )
        )
    elif args.cmd == "agreement":
        print(
            json.dumps(
                {k: v for k, v in agreement(args.out, calibration).items() if k != "rows"}, indent=1
            )
        )
    else:
        print(json.dumps({k: v for k, v in report(args.out).items() if k != "cases"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
