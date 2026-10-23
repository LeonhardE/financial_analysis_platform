"""Stable opaque document ownership across all private services."""

import hashlib


def owner_key(uid: str) -> str:
    return hashlib.sha256(uid.encode()).hexdigest()
