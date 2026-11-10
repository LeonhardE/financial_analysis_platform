"""Root-verified current Hub directory/consent, with durable monotonic client pins."""

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.persistent_agents import (
    initial_agent_identity,
    validate_persistent_schema,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.persistent_content import BINDING_FIELDS, CONTENT_PROFILE
from folioview_shared.encrypted.resource_consents import (
    approve_resource_consent,
    resource_consent_digest,
    revoke_resource_consent,
)
from folioview_shared.encrypted.schema import validate_schema

from .contracts import closed, require


def directory(session, core, native, old_pins, now):
    closed(
        session,
        {
            "contractVersion",
            "profile",
            "identity",
            "binding",
            "rootJwk",
            "registryHistory",
            "consent",
            "consentOperations",
            "registrySequence",
        },
        maximum=1048576,
    )
    require(
        session["contractVersion"] == CONTRACT_VERSION
        and session["profile"] == CONTENT_PROFILE
        and session["rootJwk"] == core.public["rootJwk"]
    )
    binding = core.binding
    history = session["registryHistory"]
    require(type(history) is list and 1 <= len(history) <= 128)
    registries = {}
    previous = None
    for bundle in history:
        current = verify_registry(
            bundle,
            root_jwk=core.public["rootJwk"],
            pinned_root_key_id=binding["rootKeyId"],
            owner_subject=binding["ownerSubject"],
            vault_id=binding["vaultId"],
            now=now,
            previous=previous,
        )
        require(current.registry_sequence not in registries)
        registries[current.registry_sequence] = current
        previous = current
    registry = previous
    anchor = native.anchor(core, now)
    require(
        registry.checkpoint_history.get(anchor.registry_sequence) == anchor.checkpoint_digest
        and registry.registry_sequence >= anchor.registry_sequence
        and registry.registry_sequence == session["registrySequence"]
    )
    if old_pins is not None:
        require(
            registry.registry_sequence >= old_pins["registrySequence"]
            and registry.checkpoint_history.get(old_pins["registrySequence"])
            == old_pins["checkpointDigest"]
        )
    identity = validate_persistent_schema("PersistentAgentIdentity", session["identity"])
    require(
        identity["status"] == "active"
        and identity["registeredAt"] <= now
        and all(identity[k] == binding[k] for k in BINDING_FIELDS)
    )
    _, command = _signed_parts(session["binding"])
    issuance = registries.get(command["registrySequence"])
    require(issuance is not None)
    verified = verify_agent_identity_binding(
        session["binding"],
        registry=issuance,
        owner_subject=binding["ownerSubject"],
        vault_id=binding["vaultId"],
        connection_id=core.connection,
        agent_id=binding["agentId"],
        client_id=binding["clientId"],
        now=identity["registeredAt"],
    )
    require(
        verified.fingerprint == binding["bindingFingerprint"]
        and initial_agent_identity(verified) == identity
    )
    for key, role in [("agentSigningKeyId", "agent_sig"), ("agentEncryptionKeyId", "agent_enc")]:
        registry.cert(binding[key], role=role, connection_id=core.connection, now=now)
    recipients = sorted(
        k
        for k in registry.active_key_ids
        if registry.certificates[k]["role"] in {"device_enc", "recovery_enc"}
        and registry.certificates[k]["connectionId"] is None
        and registry.certificates[k]["notBefore"] <= now < registry.certificates[k]["expiresAt"]
    )
    require(recipients == binding["recipientKeyIds"])
    return registry, registries, identity


def consent_chain(hub, session, registries, registry, identity, core, old_pins, now):
    operations = session["consentOperations"]
    require(
        type(operations) is list
        and len(operations) <= 64
        and len(set(operations)) == len(operations)
    )
    state, observed = None, {}
    for operation in operations:
        validate_schema("OperationIdentifier", operation)
        row = hub.call("consent-receipts", {"operationId": operation})
        closed(
            row,
            {
                "contractVersion",
                "profile",
                "operationId",
                "fingerprint",
                "priorDigest",
                "consent",
                "command",
                "sourceStates",
            },
            maximum=98304,
        )
        _, payload = _signed_parts(row["command"])
        require(
            row["operationId"] == operation == payload["stableOperationId"]
            and row["fingerprint"] == signing_input_fingerprint(row["command"])
            and row["priorDigest"] == (None if state is None else resource_consent_digest(state))
        )
        issuance = registries.get(payload["registrySequence"])
        require(issuance is not None and payload["issuedAt"] <= now)
        b = core.binding
        args = {
            "current_consent": state,
            "current_identity": identity,
            "registry": issuance,
            "root_jwk": core.public["rootJwk"],
            "owner_subject": b["ownerSubject"],
            "vault_id": b["vaultId"],
            "connection_id": b["connectionId"],
            "client_id": b["clientId"],
            "consent_id": payload["consentId"],
            "now": payload["issuedAt"],
        }
        if payload["artifactType"] == "persistent_resource_approval":
            state = approve_resource_consent(
                row["command"], source_states=row["sourceStates"], **args
            )
        else:
            require(
                payload["artifactType"] == "persistent_resource_revocation" and state is not None
            )
            state = revoke_resource_consent(row["command"], **args)
        require(state == row["consent"])
        observed[state["version"]] = resource_consent_digest(state)
    require(state == session["consent"])
    version, fingerprint = (
        (0, None) if state is None else (state["version"], resource_consent_digest(state))
    )
    if old_pins is not None:
        require(version >= old_pins["consentVersion"])
        if old_pins["consentVersion"]:
            require(observed.get(old_pins["consentVersion"]) == old_pins["consentDigest"])
    pins = {
        "registrySequence": registry.registry_sequence,
        "checkpointDigest": registry.checkpoint_digest,
        "consentVersion": version,
        "consentDigest": fingerprint,
    }
    return state, pins
