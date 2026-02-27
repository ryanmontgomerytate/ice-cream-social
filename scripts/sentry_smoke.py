#!/usr/bin/env python3
"""
Send a single Sentry envelope event for connectivity/testing.

Usage:
  python3 scripts/sentry_smoke.py --dsn "https://<key>@o....ingest.../PROJECT_ID"

If --dsn is omitted, uses SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN from environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send a Sentry smoke-test event")
    parser.add_argument("--dsn", help="Sentry DSN")
    parser.add_argument(
        "--message",
        default="ICS sentry smoke test",
        help="Event message",
    )
    return parser.parse_args()


def resolve_dsn(cli_dsn: str | None) -> str:
    dsn = cli_dsn or os.getenv("SENTRY_DSN") or os.getenv("NEXT_PUBLIC_SENTRY_DSN")
    if not dsn:
        raise ValueError("Missing DSN. Pass --dsn or set SENTRY_DSN/NEXT_PUBLIC_SENTRY_DSN.")
    return dsn.strip()


def envelope_url_from_dsn(dsn: str) -> str:
    parsed = urllib.parse.urlparse(dsn)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("Invalid DSN (missing scheme/host).")
    project_id = parsed.path.strip("/")
    if not project_id:
        raise ValueError("Invalid DSN (missing project id path).")
    return f"{parsed.scheme}://{parsed.hostname}/api/{project_id}/envelope/"


def send_event(dsn: str, message: str) -> tuple[int, str]:
    event_id = uuid.uuid4().hex
    envelope_url = envelope_url_from_dsn(dsn)

    event = {
        "event_id": event_id,
        "message": message,
        "level": "error",
        "platform": "python",
    }

    envelope = (
        json.dumps({"event_id": event_id, "dsn": dsn}) + "\n"
        + json.dumps({"type": "event"}) + "\n"
        + json.dumps(event) + "\n"
    ).encode("utf-8")

    req = urllib.request.Request(
        envelope_url,
        data=envelope,
        headers={"Content-Type": "application/x-sentry-envelope"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        _ = resp.read()
        return resp.status, event_id


def main() -> int:
    args = parse_args()
    try:
        dsn = resolve_dsn(args.dsn)
        status, event_id = send_event(dsn, args.message)
        print(f"HTTP {status}")
        print(f"EVENT_ID {event_id}")
        return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        print(f"HTTP_ERROR {exc.code}", file=sys.stderr)
        if body:
            print(body, file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
