"""Immutable Run input bindings, independent of storage and execution permission.

A manifest has no additional root/server content signature. Its signed agent
intent fixes selected inputs; complete original author envelopes fix each input.
These checks do not replace OAuth, current task/source fences, transactional Run
state, or historical root/certificate trust policy. No content is decrypted.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from .authority import VerifiedGrant, VerifiedRegistry, verify_begin_intent
from .budgets import check_manifest_budget, check_read_response
from .constants import CONTRACT_VERSION, MAX_RUN_SECONDS, MAX_SAFE_INTEGER
from .crypto import _signed_parts, signing_input_fingerprint, verify_jws
from .envelope import manifest_fingerprint, parse_carrier
from .errors import ContractError
from .jsonutil import canonical_json, strict_json_loads
from .schema import validate_schema

_RESOURCE_TYPES = {
    "holdings": "holdings_snapshot",
    "watchlist": "watchlist_evidence",
    "channel_follows": "channel_follows_evidence",
}


def _require(value: bool) -> None:
    if not value:
        raise ContractError("recipient_binding_mismatch")


def _same(left: object, right: object) -> bool:
    return canonical_json(left) == canonical_json(right)


def _now(value: int) -> datetime:
    try:
        if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
            raise ValueError
        return datetime.fromtimestamp(value, UTC)
    except (ValueError, OverflowError, OSError):
        raise ContractError("malformed_request") from None


def _lifetime(value: dict, *, grant: VerifiedGrant, now: int) -> None:
    # The schema requires UTC timestamps; compare datetimes to retain fractions.
    created = datetime.fromisoformat(value["createdAt"])
    expires = datetime.fromisoformat(value["expiresAt"])
    if (
        not created <= _now(now) < expires
        or not 0 < (expires - created).total_seconds() <= MAX_RUN_SECONDS
        or created < _now(grant["notBefore"])
        or expires > _now(grant["expiresAt"])
    ):
        raise ContractError("key_authorization_required")


@dataclass(frozen=True)
class ManifestExpectation:
    """Independent routing pins, including the retained agent intent identity.

    Obtain allocated IDs from the authenticated Run operation/state and retain
    begin_intent_fingerprint when signing the intent. Never manufacture these
    pins by copying the response being checked.
    """

    owner_subject: str
    vault_id: str
    run_id: str
    manifest_id: str
    initial_result_id: str
    begin_intent_fingerprint: str


@dataclass(frozen=True)
class VerifiedManifest:
    """A fixed input selection; this is not an execution authorization token."""

    _manifest_bytes: bytes
    _run_bytes: bytes
    _intent_bytes: bytes
    _registry: VerifiedRegistry
    _grant: VerifiedGrant
    _verified_at: int
    fingerprint: str

    @property
    def manifest(self) -> dict:
        return strict_json_loads(self._manifest_bytes)

    @property
    def run(self) -> dict:
        return strict_json_loads(self._run_bytes)

    @property
    def intent(self) -> dict:
        return strict_json_loads(self._intent_bytes)


@dataclass(frozen=True)
class BoundComponent:
    """A complete carrier matching a manifest reference, before author trust."""

    _carrier_bytes: bytes
    _context_bytes: bytes
    fingerprint: str
    component_index: int

    @property
    def carrier(self) -> dict:
        return strict_json_loads(self._carrier_bytes)

    @property
    def context(self) -> dict:
        return strict_json_loads(self._context_bytes)


def validate_run_descriptor(
    value: dict,
    *,
    registry: VerifiedRegistry,
    grant: VerifiedGrant,
    expectation: ManifestExpectation,
    now: int,
) -> dict:
    """Bind closed Run metadata to current authority and independent route pins.

    Recognized states describe metadata, not permission to execute. A consumer
    must separately require its allowed state and recheck current OAuth/fences.
    """
    _now(now)
    if (
        not isinstance(registry, VerifiedRegistry)
        or not isinstance(grant, VerifiedGrant)
        or not isinstance(expectation, ManifestExpectation)
        or grant.registry_digest != registry.checkpoint_digest
        or not grant["notBefore"] <= now < grant["expiresAt"]
    ):
        raise ContractError("key_authorization_required")
    run = validate_schema("RunDescriptor", value)
    _require(registry.owner_subject == expectation.owner_subject)
    _require(registry.vault_id == expectation.vault_id)
    _require(grant["ownerSubject"] == registry.owner_subject)
    _require(grant["vaultId"] == registry.vault_id)
    _require(grant["keyEpoch"] == registry.key_epoch)
    expected = {
        "vaultId": expectation.vault_id,
        "runId": expectation.run_id,
        "initialResultId": expectation.initial_result_id,
        "beginIntentFingerprint": expectation.begin_intent_fingerprint,
        "taskId": grant["taskId"],
        "taskVersion": grant.task_version,
        "connectionId": grant["connectionId"],
        "grantId": grant["grantId"],
        "grantEpoch": grant["grantEpoch"],
        "executionEpoch": grant["executionEpoch"],
        "authorizationId": grant["authorizationId"],
        "keyEpoch": registry.key_epoch,
    }
    _require(all(_same(run[field], wanted) for field, wanted in expected.items()))
    if run["state"] == "preparing":
        _require(run["manifestId"] is None)
    elif run["state"] in {"ready", "submitted"}:
        _require(run["manifestId"] == expectation.manifest_id)
    elif run["manifestId"] is not None:
        _require(run["manifestId"] == expectation.manifest_id)
    _lifetime(run, grant=grant, now=now)
    return run


def verify_manifest(
    value: dict,
    run: dict,
    *,
    registry: VerifiedRegistry,
    grant: VerifiedGrant,
    expectation: ManifestExpectation,
    now: int,
) -> VerifiedManifest:
    """Verify one current, immutable selection and its exact signed BeginRunIntent.

    The caller authenticates API transport and pins allocated Run/manifest/result
    IDs. Grant/current registry checks are performed here; original component
    author signatures and trusted historical root proofs remain separate. A
    retained intent may reference a known issuance checkpoint; unrelated later
    registry changes do not invalidate the selection. Current keys/grants still
    apply, and new Run issuance uses verify_begin_intent's stricter default.
    """
    checked_run = validate_run_descriptor(
        run, registry=registry, grant=grant, expectation=expectation, now=now
    )
    check_manifest_budget(value)
    manifest = validate_schema("ManifestDescriptor", value)
    _require(checked_run["manifestId"] == expectation.manifest_id)
    expected = {
        "manifestId": expectation.manifest_id,
        "vaultId": expectation.vault_id,
        "runId": expectation.run_id,
        "taskId": grant["taskId"],
        "taskVersion": grant.task_version,
        "connectionId": grant["connectionId"],
        "grantId": grant["grantId"],
        "grantEpoch": grant["grantEpoch"],
        "executionEpoch": grant["executionEpoch"],
        "keyEpoch": registry.key_epoch,
        "beginIntentFingerprint": expectation.begin_intent_fingerprint,
    }
    _require(all(_same(manifest[field], wanted) for field, wanted in expected.items()))
    _lifetime(manifest, grant=grant, now=now)
    _require(
        datetime.fromisoformat(checked_run["createdAt"])
        <= datetime.fromisoformat(manifest["createdAt"])
    )
    _require(
        datetime.fromisoformat(manifest["expiresAt"])
        <= datetime.fromisoformat(checked_run["expiresAt"])
    )
    task = manifest["taskEnvelope"]
    _require(task["objectId"] == manifest["taskId"])
    _require(task["revision"] == manifest["taskVersion"])
    _require(task["keyEpoch"] == registry.key_epoch)
    refs = [canonical_json(entry["ref"]) for entry in manifest["entries"]]
    _require(len(refs) == len(set(refs)))
    for entry in manifest["entries"]:
        _require(entry["objectType"] == _RESOURCE_TYPES[entry["ref"]["kind"]])
        _require(entry["keyEpoch"] == registry.key_epoch)
    selected = [
        {field: entry[field] for field in ("ref", "revision", "sourceEpoch", "envelopeFingerprint")}
        for entry in manifest["entries"]
    ]
    intent = verify_begin_intent(
        manifest["signedBeginIntent"],
        registry=registry,
        grant=grant,
        task_envelope_fingerprint=task["envelopeFingerprint"],
        resource_versions=selected,
        now=now,
        require_current_checkpoint=False,
    )
    _require(
        signing_input_fingerprint(manifest["signedBeginIntent"])
        == expectation.begin_intent_fingerprint
    )
    return VerifiedManifest(
        canonical_json(manifest),
        canonical_json(checked_run),
        canonical_json(intent),
        registry,
        grant,
        now,
        manifest_fingerprint(manifest),
    )


def validate_component_page(
    value: dict, *, manifest: VerifiedManifest, expected_index: int
) -> BoundComponent:
    """Bind exactly one whole carrier; never infer author/AEAD trust from its hash.

    Index zero is the task; subsequent indices follow signed resource selection
    order. The caller retains its next index and authenticates opaque cursors.
    Historical author proof policy, current read permission, AEAD and plaintext
    checks are deliberately independent of this structural/reference check.
    """
    if not isinstance(manifest, VerifiedManifest) or type(expected_index) is not int:
        raise ContractError("malformed_request")
    check_read_response(value)
    page = validate_schema("ManifestComponentPage", value)
    descriptor = manifest.manifest
    count = len(descriptor["entries"]) + 1
    _require(0 <= expected_index < count)
    _require(page["componentIndex"] == expected_index)
    _require(page["manifestFingerprint"] == manifest.fingerprint)
    _require(canonical_json(page["manifest"]) == manifest._manifest_bytes)
    _require((page["nextCursor"] is None) == (expected_index == count - 1))
    component = page["component"]
    reference = (
        descriptor["taskEnvelope"]
        if expected_index == 0
        else descriptor["entries"][expected_index - 1]
    )
    _require(component["kind"] == ("task" if expected_index == 0 else "resource"))
    for field in ("objectId", "revision", "deliveryRevision"):
        _require(component[field] == reference[field])
    carrier = parse_carrier(
        {"contractVersion": CONTRACT_VERSION, "signedObject": component["signedObject"]},
        contract_header=CONTRACT_VERSION,
    )
    _, message = _signed_parts(carrier["signedObject"])
    context = message["context"]
    registry, grant = manifest._registry, manifest._grant
    expected = {
        "ownerSubject": registry.owner_subject,
        "vaultId": registry.vault_id,
        "rootKeyId": registry.root_key_id,
        "rootEpoch": registry.root_epoch,
        "keyEpoch": reference["keyEpoch"],
        "objectType": reference["objectType"],
        "objectId": reference["objectId"],
        "revision": reference["revision"],
        "deliveryRevision": reference["deliveryRevision"],
    }
    _require(all(_same(context[field], wanted) for field, wanted in expected.items()))
    _require(
        registry.checkpoint_history.get(context["registrySequence"]) == context["checkpointDigest"]
    )
    fingerprint = signing_input_fingerprint(carrier["signedObject"])
    _require(fingerprint == reference["envelopeFingerprint"])
    if expected_index == 0:
        refs = [
            {"ref": item["ref"], "sourceEpoch": item["sourceEpoch"]}
            for item in grant["resourceBindings"]
        ]
        _require(_same(context["resourceBindings"], refs))
    else:
        _require(_same(context["binding"]["resourceRef"], reference["ref"]))
        _require(context["binding"]["sourceRevision"] == reference["revision"])
        _require(context["binding"]["sourceEpoch"] == reference["sourceEpoch"])
    agent = registry.cert(
        grant["agentEncryptionKeyId"], role="agent_enc", now=manifest._verified_at
    )
    agent_rows = [row for row in context["recipients"] if row["keyId"] == agent["keyId"]]
    _require(len(agent_rows) == 1)
    _require(
        all(
            agent_rows[0][field] == agent[field]
            for field in ("role", "principalId", "connectionId", "keyEpoch")
        )
    )
    return BoundComponent(
        canonical_json(carrier), canonical_json(context), fingerprint, expected_index
    )


def verify_component_author(
    component: BoundComponent, *, author_public_jwk: dict, expected_author_key_id: str
) -> dict:
    """Verify the original author signature using independently authenticated key material.

    A decrypting client must first establish the retained author's root proof,
    device_sig/object_write role and its explicit historical trust policy. This
    API neither resolves a request-supplied key nor calls current-write cert()
    on historical data. Signature success proves neither current permission nor
    AEAD/plaintext validity; decrypt/validate only after the full trust policy.
    """
    if not isinstance(component, BoundComponent):
        raise ContractError("malformed_request")
    _require(component.context["authorSigningKeyId"] == expected_author_key_id)
    return verify_jws(
        component.carrier["signedObject"],
        author_public_jwk,
        typ="fv-object+jws",
        expected_kid=expected_author_key_id,
    )
