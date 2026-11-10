"""Bounded public startup inputs inside the measured image, never host file mounts."""

import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

from .contracts import require, safe

ROOT_PIN = "EXECUTOR_ROOT_KEY_ID"


def remote(name):
    return name + "_OBJECT" in os.environ


def read_public(name, *, maximum=65536, client=None):
    def read():
        # A single unambiguous source; no failed-remote/local or historical fallback.
        require((name in os.environ) != remote(name))
        if not remote(name):
            with Path(os.environ[name]).open("rb") as source:
                raw = source.read(maximum + 1)
        else:
            b64url_decode(os.environ.get(ROOT_PIN), exact_bytes=32)
            require("STORAGE_EMULATOR_HOST" not in os.environ)
            uri = os.environ[name + "_OBJECT"]
            require(type(uri) is str and len(uri) <= 256)
            parsed = urlsplit(uri)
            require(
                parsed.scheme == "gs"
                and re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", parsed.netloc)
                and not parsed.query
                and not parsed.fragment
                and re.fullmatch(r"/executor-config/[A-Za-z0-9_/-]+\.json", parsed.path)
                and all(part not in {"", ".", ".."} for part in parsed.path[1:].split("/"))
            )
            from google.cloud import storage

            bucket = (client or storage.Client()).bucket(parsed.netloc)
            blob = bucket.blob(parsed.path[1:])
            blob.reload(timeout=4, retry=None)
            require(type(blob.size) is int and 1 <= blob.size <= maximum)
            generation = blob.generation
            require(type(generation) is int and generation > 0)
            raw = blob.download_as_bytes(
                if_generation_match=generation, timeout=4, retry=None, checksum="crc32c"
            )
            require(type(raw) is bytes and len(raw) == blob.size)
        value = strict_json_loads(raw, max_bytes=maximum)
        require(type(value) is dict)
        return value

    return safe(read)


def pin_root(root_jwk, *, required):
    """The complete config cannot pin its own hash inside its own workload object."""
    expected = os.environ.get(ROOT_PIN)
    if expected is None and not required:
        return
    validate_schema("PublicJWK", root_jwk)
    b64url_decode(expected, exact_bytes=32)
    require(jwk_thumbprint(root_jwk) == expected)


def measured_sources(workload, names):
    """Each remote source and independent Root pin must itself be Root-approved."""
    selected = [name + "_OBJECT" for name in names if remote(name)]
    if selected:
        environment = workload["environment"]
        for name in [ROOT_PIN, *selected]:
            require(environment.get(name) == os.environ.get(name))
