#!/usr/bin/env python3
"""Provisions AWS API Gateway endpoints used for outbound IP rotation, as a
replacement for the http proxy list in `data/settings.json` -- see
`gratovo/scrapetube/proxy_pool.py`'s module doc comment for how a deployed
gateway is used at request time.

    python tools/aws_gateway_setup.py deploy
    python tools/aws_gateway_setup.py deploy --regions us-east-1,eu-west-1,ap-southeast-1
    python tools/aws_gateway_setup.py list
    python tools/aws_gateway_setup.py enable
    python tools/aws_gateway_setup.py disable
    python tools/aws_gateway_setup.py test
    python tools/aws_gateway_setup.py destroy

WHAT THIS BUILDS
-----------------
One HTTP API (API Gateway v2, not the older REST API type -- see COST below)
per region, with a single `ANY /{proxy+}` route behind an HTTP_PROXY
integration whose backend URI is `https://www.youtube.com/{proxy}`. API
Gateway forwards whatever path, query string and body it receives straight to
that same path on youtube.com and hands the response straight back -- so from
`scrapetube`'s point of view, the invoke URL just *is* youtube.com, except the
outbound connection to YouTube now originates from AWS's IP range in that
region instead of this machine's. Deploying to several regions and rotating
across them (`proxy_pool.py` round-robins exactly like it does for real
proxies) is what stands in for a proxy list without renting one.

This never touches `data/settings.json` -- the existing http proxy list and
its Settings screen are untouched, per design. The endpoints this writes live
in their own file, `data/aws_gateways.json` (gitignored: it embeds this AWS
account's API ids), and `config.load_aws_gateways()` reads them only when
that file's top-level "enabled" is true. `enable`/`disable` flip that flag
without touching AWS; `deploy` always leaves it enabled so a first run works
end to end.

SECURITY TRADE-OFF, ON PURPOSE
-------------------------------
Each method is created with `authorizationType="NONE"` and no API key: the
invoke URL, if someone else got hold of it, could be used by anyone as a free
relay -- but only ever to youtube.com, since the integration's backend URI is
fixed. That's judged an acceptable trade-off for a low-traffic personal/team
tool (an API-key usage plan is real complexity -- request signing or an extra
header on every call -- for a proxy whose worst case is "someone else uses my
AWS free tier to browse YouTube"), but don't hand the invoke URLs out, and
`destroy` is there if that stops being true.

COST
----
HTTP APIs (this module) bill at roughly $1.00 per million calls; the older
REST API type bills at roughly $3.50 per million for the same traffic and
offers nothing this use case needs (usage plans, request validators, AWS
service integrations -- none of that applies to a plain HTTP_PROXY
pass-through to a public backend). Both are free for the account's first 12
months up to 1M calls/month combined across all HTTP APIs; past that (or
after the 12 months) it is billed per call. A handful of regions at
scraper-sized traffic stays well inside the free tier, but nothing here
enforces that -- keep an eye on usage if this is meant to stay free.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gratovo import config  # noqa: E402

DEFAULT_REGIONS = ["us-east-1", "eu-west-1"]
API_NAME = "gratovo-yt-proxy"
# The special stage name whose invoke URL has no stage segment in it --
# https://{api-id}.execute-api.{region}.amazonaws.com/{path}, not .../prod/{path}.
STAGE_NAME = "$default"
BACKEND_ORIGIN = "https://www.youtube.com"


class SetupError(Exception):
    pass


def _client(cfg: config.Config, region: str):
    if not cfg.aws_configured:
        raise SetupError(
            "AWS_IAM_ACCESS_KEY_ID / AWS_IAM_SECRET_ACCESS_KEY are not set in data/.env.local")
    import boto3
    # apigatewayv2 == HTTP APIs; the plain "apigateway" client is v1 (REST
    # APIs), a different, pricier product for what this needs -- see COST.
    return boto3.client(
        "apigatewayv2",
        region_name=region,
        aws_access_key_id=cfg.aws_access_key_id,
        aws_secret_access_key=cfg.aws_secret_access_key,
    )


def _load_state() -> dict:
    data = config.load_json_file(config.AWS_GATEWAYS_PATH, {}) or {}
    data.setdefault("enabled", False)
    data.setdefault("gateways", [])
    return data


def _save_state(state: dict) -> None:
    config.AWS_GATEWAYS_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.AWS_GATEWAYS_PATH.write_text(
        json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _invoke_url(api_id: str, region: str) -> str:
    # No stage segment: $default is the one stage name API Gateway omits
    # from the invoke URL.
    return "https://{}.execute-api.{}.amazonaws.com".format(api_id, region)


def _deploy_region(cfg: config.Config, region: str) -> dict:
    client = _client(cfg, region)

    print(f"[{region}] creating HTTP API...")
    api = client.create_api(Name=API_NAME, ProtocolType="HTTP")
    api_id = api["ApiId"]

    # Deliberately not the `Target=` quick-create shortcut: quick create's
    # auto route is the literal `$default` catch-all, which has no `{proxy}`
    # path variable to substitute into the integration URI, so it always
    # forwards to exactly `BACKEND_ORIGIN` regardless of the request path.
    # An explicit `{proxy+}` route is what makes `.../results?...` and
    # `.../youtubei/v1/search` actually reach the matching youtube.com path.
    integration = client.create_integration(
        ApiId=api_id,
        IntegrationType="HTTP_PROXY",
        IntegrationMethod="ANY",
        IntegrationUri=BACKEND_ORIGIN + "/{proxy}",
        PayloadFormatVersion="1.0",
    )
    client.create_route(
        ApiId=api_id,
        RouteKey="ANY /{proxy+}",
        Target="integrations/{}".format(integration["IntegrationId"]),
    )

    print(f"[{region}] deploying stage '{STAGE_NAME}'...")
    client.create_stage(ApiId=api_id, StageName=STAGE_NAME, AutoDeploy=True)

    url = _invoke_url(api_id, region)
    print(f"[{region}] ready: {url}")
    return {"region": region, "api_id": api_id, "url": url}


def cmd_deploy(cfg: config.Config, args) -> int:
    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    state = _load_state()
    existing_regions = {g["region"] for g in state["gateways"]}

    for region in regions:
        if region in existing_regions and not args.force:
            print(f"[{region}] already deployed (rerun with --force to replace) -- skipping.")
            continue
        if region in existing_regions and args.force:
            state["gateways"] = [g for g in state["gateways"] if g["region"] != region]
        try:
            entry = _deploy_region(cfg, region)
        except Exception as exc:  # noqa: BLE001 - one region's failure shouldn't stop the rest
            print(f"[{region}] FAILED: {exc}")
            continue
        state["gateways"].append(entry)
        _save_state(state)  # saved after every region, so a later failure loses nothing already done

    # Only flip the switch if something actually deployed -- leaving
    # enabled=true with zero gateways is harmless (load_aws_gateways() would
    # just return []) but is a misleading thing to find in the file.
    if state["gateways"]:
        state["enabled"] = True
        _save_state(state)
        print(f"\n{len(state['gateways'])} gateway(s) recorded in {config.AWS_GATEWAYS_PATH}, enabled=true.")
        return 0
    print("\nno gateway deployed successfully -- leaving enabled as-is.")
    return 1


def cmd_list(cfg: config.Config, args) -> int:
    state = _load_state()
    print(f"enabled: {state['enabled']}")
    if not state["gateways"]:
        print("no gateways deployed -- run `deploy` first.")
        return 0
    for g in state["gateways"]:
        print(f"  {g['region']:<15} {g['url']}  (api_id={g['api_id']})")
    return 0


def cmd_enable(cfg: config.Config, args) -> int:
    state = _load_state()
    state["enabled"] = True
    _save_state(state)
    print("enabled.")
    return 0


def cmd_disable(cfg: config.Config, args) -> int:
    state = _load_state()
    state["enabled"] = False
    _save_state(state)
    print("disabled -- scrapetube falls back to the http proxy list / direct.")
    return 0


def cmd_test(cfg: config.Config, args) -> int:
    import requests
    state = _load_state()
    if not state["gateways"]:
        print("no gateways deployed -- run `deploy` first.")
        return 1
    ok = 0
    for g in state["gateways"]:
        url = g["url"] + "/generate_204"
        try:
            resp = requests.get(url, timeout=15)
            print(f"  {g['region']:<15} HTTP {resp.status_code} from {url}")
            if resp.status_code < 500:
                ok += 1
        except requests.RequestException as exc:
            print(f"  {g['region']:<15} FAILED: {exc}")
    print(f"\n{ok}/{len(state['gateways'])} reachable.")
    return 0 if ok == len(state["gateways"]) else 1


def cmd_destroy(cfg: config.Config, args) -> int:
    state = _load_state()
    if not state["gateways"]:
        print("nothing to destroy.")
        return 0
    remaining = []
    for g in state["gateways"]:
        try:
            client = _client(cfg, g["region"])
            client.delete_api(ApiId=g["api_id"])
            print(f"[{g['region']}] deleted {g['api_id']}")
        except Exception as exc:  # noqa: BLE001
            print(f"[{g['region']}] FAILED to delete {g['api_id']}: {exc} -- leaving it recorded.")
            remaining.append(g)
    state["gateways"] = remaining
    if not remaining:
        state["enabled"] = False
    _save_state(state)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_deploy = sub.add_parser("deploy", help="create/deploy the API Gateway proxies")
    p_deploy.add_argument("--regions", default=",".join(DEFAULT_REGIONS),
                          help=f"comma-separated AWS regions (default: {','.join(DEFAULT_REGIONS)})")
    p_deploy.add_argument("--force", action="store_true",
                          help="replace a region already recorded in aws_gateways.json")

    sub.add_parser("list", help="show what is recorded in data/aws_gateways.json")
    sub.add_parser("enable", help="turn on routing through recorded gateways")
    sub.add_parser("disable", help="turn off routing (keeps AWS resources up)")
    sub.add_parser("test", help="hit every recorded gateway once and report status")
    sub.add_parser("destroy", help="delete every recorded gateway from AWS")

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = config.load()
    try:
        return {
            "deploy": cmd_deploy,
            "list": cmd_list,
            "enable": cmd_enable,
            "disable": cmd_disable,
            "test": cmd_test,
            "destroy": cmd_destroy,
        }[args.command](cfg, args)
    except SetupError as exc:
        print(f"error: {exc}")
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
