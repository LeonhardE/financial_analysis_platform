"""Exact immutable registry prefixes retained only by a transaction attempt."""

from folioview_shared.encrypted.authority import VerifiedRegistry
from folioview_shared.encrypted.constants import MAX_SAFE_INTEGER
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json

MAX_PREFIX_HISTORIES = 8
MAX_PREFIX_BYTES = 8 * 1024 * 1024


def _key(owner, row):
    return (
        owner,
        row["ownerSubject"],
        row["vaultId"],
        row["rootKeyId"],
        canonical_json(row["rootJwk"]),
        canonical_json(row["registryHistory"]),
    )


class RegistryPrefixCache:
    """No prefilled dictionary, mutable registry or cross-attempt authority state."""

    __slots__ = ("__entries", "__bytes")

    def __init__(self):
        self.__entries = {}
        self.__bytes = 0

    def _remember(self, owner, row, registries):
        # Only the successful complete _verify_row path publishes its verified
        # values. No partial prefix is admitted if a later bundle/row fails.
        if (
            type(registries) is not tuple
            or len(registries) != len(row["registryHistory"])
            or any(type(value) is not VerifiedRegistry for value in registries)
        ):
            return
        key = _key(owner, row)
        size = len(key[-2]) + len(key[-1])
        if (
            key in self.__entries
            or len(self.__entries) >= MAX_PREFIX_HISTORIES
            or size > MAX_PREFIX_BYTES - self.__bytes
        ):
            return
        self.__entries[key] = registries
        self.__bytes += size

    def get(self, owner, row, position, written_at):
        if type(written_at) is not int or not 0 <= written_at <= MAX_SAFE_INTEGER:
            raise ContractError("malformed_request")
        values = self.__entries.get(_key(owner, row))
        if values is None:
            return None
        if type(position) is not int or not 0 <= position < len(values):
            raise ContractError("registry_conflict")
        registry = values[position]
        if registry.issued_at > written_at:
            raise ContractError("registry_conflict")
        return registry
