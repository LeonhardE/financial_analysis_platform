"""User-local list consistency metadata; never a public content fingerprint."""

import hashlib
import re
import time
from datetime import UTC, datetime
from uuid import uuid4

from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.identity import owner_key
from folioview_shared.instruments import iso_time

KINDS = frozenset({"watchlist", "channel_follows"})
MAX_REVISION = 9_007_199_254_740_991
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


def version_key(uid: str, kind: str) -> str:
    if kind not in KINDS:
        raise ValueError("Invalid resource kind")
    return f"{owner_key(uid)}_{kind}"


def content_digest(items: list[dict]) -> str:
    return hashlib.sha256(canonical_json(items)).hexdigest()


def checked_time(value):
    if type(value) is not str or not 20 <= len(value) <= 40 or not value.endswith("Z"):
        raise ValueError("Invalid source timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo != UTC:
        raise ValueError("Invalid source timestamp")
    return parsed


def validate_version(kind: str, items: list[dict], metadata: object) -> dict | None:
    if metadata is None:
        return None
    if (
        type(metadata) is not dict
        or set(metadata)
        != {"version", "ref", "revision", "sourceEpoch", "contentDigest", "updatedAt"}
        or type(metadata["version"]) is not int
        or metadata["version"] != 1
        or type(metadata["revision"]) is not int
        or not 0 <= metadata["revision"] <= MAX_REVISION
        or (metadata["revision"] == 0 and items)
        or type(metadata["sourceEpoch"]) is not int
        or not 1 <= metadata["sourceEpoch"] <= MAX_REVISION
    ):
        raise ValueError("Invalid resource metadata")
    ref = metadata["ref"]
    if (
        kind not in KINDS
        or type(ref) is not dict
        or set(ref) != {"kind", "sourceService", "resourceId", "incarnation"}
        or ref["kind"] != kind
        or ref["sourceService"] != "user"
        or not all(
            type(ref[key]) is str and IDENTIFIER.fullmatch(ref[key])
            for key in ("resourceId", "incarnation")
        )
        or metadata["contentDigest"] != content_digest(items)
    ):
        raise ValueError("Invalid resource binding")
    checked_time(metadata["updatedAt"])
    return metadata


def new_version(kind: str, items: list[dict], *, previous=None, initial=False) -> dict:
    if kind not in KINDS:
        raise ValueError("Invalid resource kind")
    revision = previous["revision"] + 1 if previous else (int(bool(items)) if initial else 1)
    if revision > MAX_REVISION:
        raise ValueError("Resource revision exhausted")
    return {
        "version": 1,
        "ref": previous["ref"]
        if previous
        else {
            "kind": kind,
            "sourceService": "user",
            "resourceId": f"ur_{uuid4().hex}",
            "incarnation": uuid4().hex,
        },
        "revision": revision,
        "sourceEpoch": previous["sourceEpoch"] if previous else 1,
        "contentDigest": content_digest(items),
        "updatedAt": iso_time(time.time()),
    }
