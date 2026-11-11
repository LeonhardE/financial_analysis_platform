"""Owner-only public consent lineage; no Agent key or browser-local recovery file."""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema

from .persistent_agents import linked_connection, snapshot, stored_identity
from .resource_consents import stored_consent
from .store import StoreUnavailable, document_path

PROFILE = "folioview.agent-restoration.v1"


def lineage_path(owner, vault, connection, fingerprint):
    validate_schema("Digest", fingerprint)
    return document_path("hub_credential_lineage", owner, vault, connection, fingerprint)


def descriptor(row):
    identity = row["identity"]
    lease = row.get("credentialLease")
    return {
        "connectionId": identity["connectionId"],
        "bindingFingerprint": identity["bindingFingerprint"],
        "credentialFingerprint": None if lease is None else lease["credentialFingerprint"],
        "generation": 0 if lease is None else lease["generation"],
    }


def write_lineage(unit, owner, vault, connection, row, previous):
    ref = descriptor(row)
    path = lineage_path(owner, vault, connection, ref["bindingFingerprint"])
    if unit.get(path) is not None:
        raise StoreUnavailable
    unit.put(
        path,
        {
            "ownerSubject": owner,
            "vaultId": vault,
            "clientId": row["identity"]["clientId"],
            **ref,
            "predecessor": None if previous is None else descriptor(previous),
        },
    )


def predecessor(unit, owner, vault, row):
    ref = descriptor(row)
    value = unit.get(lineage_path(owner, vault, ref["connectionId"], ref["bindingFingerprint"]))
    if value is None:
        # Backward-compatible first-generation records have no earlier managed
        # credential. Later generations must never silently erase their lineage.
        if ref["generation"] > 1:
            raise StoreUnavailable
        return None
    if (
        type(value) is not dict
        or set(value) != {"ownerSubject", "vaultId", "clientId", *ref, "predecessor"}
        or any(value[k] != v for k, v in ref.items())
        or value["ownerSubject"] != owner
        or value["vaultId"] != vault
        or value["clientId"] != row["identity"]["clientId"]
    ):
        raise StoreUnavailable
    previous = value["predecessor"]
    if previous is None:
        if ref["generation"] != 1:
            raise StoreUnavailable
        return None
    if type(previous) is not dict or set(previous) != set(ref):
        raise StoreUnavailable
    try:
        validate_schema("Identifier", previous["connectionId"])
        validate_schema("Digest", previous["bindingFingerprint"])
        if type(previous["generation"]) is not int or previous["generation"] < 0:
            raise StoreUnavailable
        if previous["credentialFingerprint"] is not None:
            validate_schema("Digest", previous["credentialFingerprint"])
        if ref["generation"] > 1:
            lease = row["credentialLease"]
            if (
                previous["connectionId"] != ref["connectionId"]
                or previous["generation"] + 1 != ref["generation"]
                or previous["credentialFingerprint"] != lease["previousCredentialFingerprint"]
            ):
                raise StoreUnavailable
        elif previous["generation"] != 0 or previous["credentialFingerprint"] is not None:
            raise StoreUnavailable
    except ContractError:
        raise StoreUnavailable from None
    return snapshot(previous)


def head(service, uid, vault, connection):
    for value in (vault, connection):
        validate_schema("Identifier", value)

    def read(unit):
        owner, _, _, _ = service._context(unit, uid, vault, connection)
        row = stored_identity(unit, owner, vault, connection)
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "source": None if row is None else descriptor(row),
        }

    return service.store.transact(read)


def source(service, uid, vault, connection, source_connection, fingerprint):
    for value in (vault, connection, source_connection):
        validate_schema("Identifier", value)
    validate_schema("Digest", fingerprint)

    def read(unit):
        owner, _, _, target = service._context(unit, uid, vault, connection)
        parent = linked_connection(unit, owner, vault, source_connection)
        if any(parent[k] != target[k] for k in ("ownerSubject", "vaultId", "clientId", "provider")):
            raise ContractError("not_found")
        row = stored_identity(
            unit, owner, vault, source_connection, binding_fingerprint=fingerprint
        )
        if row is None:
            raise ContractError("not_found")
        if (
            row["identity"]["clientId"] != parent["clientId"]
            or signing_input_fingerprint(row["binding"]) != fingerprint
        ):
            raise StoreUnavailable
        current = stored_identity(unit, owner, vault, source_connection)
        historical = (
            source_connection != connection
            or current is None
            or current["identity"]["bindingFingerprint"] != fingerprint
        )
        policy = stored_consent(
            unit, owner, vault, source_connection, binding_fingerprint=fingerprint
        )
        result = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "source": descriptor(row),
            "historical": historical,
            "identityState": {
                "contractVersion": CONTRACT_VERSION,
                "profile": "folioview.persistent-agent-identity.v1",
                "identity": row["identity"],
                "binding": row["binding"],
                "revocation": row["revocation"],
                "connectionRevoked": historical or parent["status"] != "active",
            },
            "credential": None
            if "credentialLease" not in row
            else {"lease": row["credentialLease"], "approval": row["credentialApproval"]},
            "resourceState": {
                "contractVersion": CONTRACT_VERSION,
                "profile": "folioview.persistent-resource-consent.v1",
                "consent": None if policy is None else policy["consent"],
                "operations": [] if policy is None else policy["operations"],
                "parentRevoked": parent["status"] != "active"
                or row["identity"]["status"] != "active",
            },
            "predecessor": predecessor(unit, owner, vault, row)
            if "credentialLease" in row
            else None,
        }
        if len(canonical_json(result)) > 262144:
            raise StoreUnavailable
        return snapshot(result)

    return service.store.transact(read)
