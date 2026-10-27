"""Synthetic root/owner/agent authority tests; no key material leaves memory."""

import copy
import hashlib
import unittest

from jwcrypto import jwk

from folioview_shared.encrypted.authority import (
    VerifiedGrant,
    verify_agent_grant,
    verify_begin_intent,
    verify_control_command,
    verify_registry,
    verify_resource_scope,
    verify_task_transition,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_GRANT_SECONDS
from folioview_shared.encrypted.crypto import jwk_thumbprint, sign_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json


def digest(payload):
    return hashlib.sha256(canonical_json(payload)).hexdigest()


class AuthorityFixture:
    def __init__(self, owner="owner_A", vault="vault_A"):
        self.owner, self.vault = owner, vault
        self.keys = {}
        self.certificates = {}
        self.root = jwk.JWK.generate(kty="EC", crv="P-256")
        self.root_public = self.public(self.root)
        self.root_id = jwk_thumbprint(self.root_public)
        self.add_key("device_sig", "device_sig", "device_A")
        self.add_key("device_enc", "device_enc", "device_A")
        self.add_key("recovery_enc", "recovery_enc", "recovery_A")
        for agent in ("A1", "A2"):
            self.add_key(agent + "_sig", "agent_sig", agent, "connection_" + agent)
            self.add_key(agent + "_enc", "agent_enc", agent, "connection_" + agent)
        self.resource = {
            "kind": "holdings",
            "sourceService": "portfolio",
            "resourceId": "holdings_A",
            "incarnation": "incarnation_A",
        }
        self.bundle = self.make_bundle()
        self.registry = self.verify(self.bundle)

    @staticmethod
    def public(key):
        value = key.export(private_key=False, as_dict=True)
        return {field: value[field] for field in ("kty", "crv", "x", "y")}

    def base(self, artifact):
        return {
            "artifactType": artifact,
            "contractVersion": CONTRACT_VERSION,
            "vaultId": self.vault,
            "ownerSubject": self.owner,
        }

    def add_key(self, name, role, principal, connection=None, epoch=1):
        key = jwk.JWK.generate(kty="EC", crv="P-256")
        self.keys[name] = key
        public = self.public(key)
        capabilities = {
            "device_sig": ["object_write", "task_grant", "control_write"],
            "agent_sig": ["run_request", "result_write"],
        }.get(role, [])
        cert = self.base("key_certificate") | {
            "certificateId": "certificate_" + name,
            "keyId": jwk_thumbprint(public),
            "role": role,
            "publicJwk": public,
            "principalId": principal,
            "connectionId": connection,
            "keyEpoch": epoch,
            "issuerKeyId": self.root_id,
            "notBefore": 100,
            "expiresAt": 5000,
            "capabilities": capabilities,
        }
        self.certificates[name] = cert
        return cert

    def kid(self, name):
        return self.certificates[name]["keyId"]

    def sign(self, payload, name="device_sig", typ="fv-control+jws"):
        key = self.root if name == "root" else self.keys[name]
        return sign_jws(payload, key, typ=typ)

    def make_bundle(
        self,
        *,
        previous=None,
        revoked=(),
        sequence=None,
        key_epoch=1,
        issued_at=None,
        checkpoint_overrides=None,
        certificates=None,
    ):
        revoked_ids = sorted(self.kid(name) for name in revoked)
        certificates = self.certificates if certificates is None else certificates
        descriptions, entries = [], []
        for cert in certificates.values():
            active = cert["keyId"] not in revoked_ids
            entries.append({"certificate": self.sign(cert, "root"), "active": active})
            descriptions.append(
                {
                    "certificateId": cert["certificateId"],
                    "payloadDigest": digest(cert),
                    "active": active,
                }
            )
        cp = self.base("registry_checkpoint") | {
            "rootKeyId": self.root_id,
            "rootEpoch": 1,
            "registrySequence": sequence or (previous.registry_sequence + 1 if previous else 1),
            "previousDigest": previous.checkpoint_digest if previous else None,
            "entriesDigest": digest(sorted(descriptions, key=lambda row: row["certificateId"])),
            "keyEpoch": key_epoch,
            "revokedKeyIds": revoked_ids,
            "issuedAt": issued_at
            if issued_at is not None
            else (previous.issued_at + 1 if previous else 500),
        }
        cp.update(checkpoint_overrides or {})
        return {
            "contractVersion": CONTRACT_VERSION,
            "checkpoint": self.sign(cp, "root"),
            "entries": entries,
        }

    def verify(self, bundle, **kwargs):
        expected = {
            "root_jwk": self.root_public,
            "pinned_root_key_id": self.root_id,
            "owner_subject": self.owner,
            "vault_id": self.vault,
            "now": 1000,
        }
        expected.update(kwargs)
        return verify_registry(bundle, **expected)

    def binding(self):
        return {
            "ref": copy.deepcopy(self.resource),
            "sourceEpoch": 1,
            "versionAccess": "selected",
            "selectedVersions": [1],
        }

    def grant(self, agent="A1", **overrides):
        reg = self.registry
        result = self.base("agent_key_grant") | {
            "authorizationId": "authorization_" + agent,
            "deviceSigningKeyId": self.kid("device_sig"),
            "connectionId": "connection_" + agent,
            "taskId": "task_" + agent,
            "taskVersions": [1],
            "executionEpoch": 1,
            "grantId": "grant_" + agent,
            "grantEpoch": 1,
            "agentSigningKeyId": self.kid(agent + "_sig"),
            "agentSigningKeyEpoch": 1,
            "agentEncryptionKeyId": self.kid(agent + "_enc"),
            "agentEncryptionKeyEpoch": 1,
            "keyEpoch": reg.key_epoch,
            "resourceBindings": [self.binding()],
            "capabilities": ["decrypt_task", "decrypt_resources", "encrypt_result"],
            "writebackRecipientKeyIds": sorted([self.kid("device_enc"), self.kid("recovery_enc")]),
            "historyPolicy": "none",
            "notBefore": 900,
            "expiresAt": 1500,
            "registrySequence": reg.registry_sequence,
            "checkpointDigest": reg.checkpoint_digest,
        }
        result.update(overrides)
        return result

    def verify_grant(self, payload=None, *, agent="A1", signed=None, **kwargs):
        if payload is None:
            payload = self.grant(agent)
        expected = {
            "registry": self.registry,
            "owner_subject": self.owner,
            "vault_id": self.vault,
            "connection_id": "connection_" + agent,
            "authorization_id": "authorization_" + agent,
            "task_id": "task_" + agent,
            "task_version": 1,
            "execution_epoch": 1,
            "grant_id": "grant_" + agent,
            "grant_epoch": 1,
            "now": 1000,
            "authorization_expires_at": 2000,
            "resource_bindings": [self.binding()],
        }
        expected.update(kwargs)
        return verify_agent_grant(signed or self.sign(payload), **expected)

    def registry_ref(self, registry=None):
        reg = registry or self.registry
        return {
            "registrySequence": reg.registry_sequence,
            "checkpointDigest": reg.checkpoint_digest,
            "keyEpoch": reg.key_epoch,
        }

    def versions(self):
        return [
            {
                "ref": copy.deepcopy(self.resource),
                "revision": 1,
                "sourceEpoch": 1,
                "envelopeFingerprint": "b" * 64,
            }
        ]

    def begin(self, agent="A1", **overrides):
        result = (
            self.base("begin_run_intent")
            | self.registry_ref()
            | {
                "stableOperationId": "0123456789abcdef0123456789abcdef",
                "taskId": "task_" + agent,
                "expectedTaskVersion": 1,
                "taskEnvelopeFingerprint": "a" * 64,
                "resourceVersions": self.versions(),
                "connectionId": "connection_" + agent,
                "grantId": "grant_" + agent,
                "grantEpoch": 1,
                "executionEpoch": 1,
                "authorizationId": "authorization_" + agent,
            }
        )
        result.update(overrides)
        return result

    def verify_begin(self, payload=None, *, grant=None, signed=None, **kwargs):
        payload = self.begin() if payload is None else payload
        expected = {
            "registry": self.registry,
            "grant": grant or self.verify_grant(),
            "task_envelope_fingerprint": "a" * 64,
            "resource_versions": self.versions(),
            "now": 1000,
        }
        expected.update(kwargs)
        return verify_begin_intent(signed or self.sign(payload, "A1_sig"), **expected)

    def command(self, **overrides):
        result = (
            self.base("control_command")
            | self.registry_ref()
            | {
                "stableOperationId": "1123456789abcdef0123456789abcdef",
                "action": "result_state_update",
                "targetId": "result_A1",
                "expectedVersion": 1,
                "expectedSourceEpoch": None,
                "parameters": {"read": True},
            }
        )
        result.update(overrides)
        return result

    def verify_command(self, payload=None, *, signed=None, **kwargs):
        payload = self.command() if payload is None else payload
        expected = {
            "registry": self.registry,
            "expected_action": "result_state_update",
            "expected_target_id": "result_A1",
            "expected_version": 1,
            "expected_source_epoch": None,
            "expected_parameters": {"read": True},
            "now": 1000,
        }
        expected.update(kwargs)
        return verify_control_command(signed or self.sign(payload), **expected)


class EncryptedAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.f = AuthorityFixture()

    def rejected(self, function, *args, codes=None, **kwargs):
        with self.assertRaises(ContractError) as caught:
            function(*args, **kwargs)
        if codes:
            self.assertIn(caught.exception.code, codes)
        return caught.exception

    def test_registry_accepts_only_the_pinned_root_and_expected_partition(self):
        f = self.f
        self.assertEqual(
            f.registry.cert(
                f.kid("A1_sig"), role="agent_sig", connection_id="connection_A1", now=1000
            ),
            f.certificates["A1_sig"],
        )
        for kwargs in (
            {"pinned_root_key_id": f.kid("device_sig")},
            {"owner_subject": "owner_B"},
            {"vault_id": "vault_B"},
            {"root_epoch": 2},
        ):
            with self.subTest(kwargs=kwargs):
                self.rejected(f.verify, f.bundle, **kwargs)
        other = AuthorityFixture("owner_B", "vault_B")
        self.rejected(f.verify, other.bundle)
        altered = copy.deepcopy(f.bundle)
        altered["checkpoint"] = f.sign(f.base("registry_checkpoint"), "device_sig")
        self.rejected(f.verify, altered, codes={"invalid_signature"})

    def test_registry_state_is_immutable_and_copies_do_not_change_authority(self):
        f = self.f
        cert = f.registry.cert(f.kid("A1_sig"), now=1000)
        cert["capabilities"].append("control_write")
        self.assertNotIn(
            "control_write", f.registry.cert(f.kid("A1_sig"), now=1000)["capabilities"]
        )
        with self.assertRaises(TypeError):
            f.registry.certificates[f.kid("A1_sig")]["role"] = "device_sig"
        with self.assertRaises(TypeError):
            f.registry.checkpoint_history[1] = "f" * 64

    def test_registry_rejects_mixed_keys_roles_and_root_certificates(self):
        f = self.f
        for field, value in (
            ("ownerSubject", "owner_B"),
            ("issuerKeyId", f.kid("device_sig")),
            ("role", "device_enc"),
            ("keyId", f.kid("A2_sig")),
            ("connectionId", None),
            ("capabilities", ["control_write"]),
            ("expiresAt", 100),
        ):
            with self.subTest(field=field):
                certs = copy.deepcopy(f.certificates)
                certs["A1_sig"][field] = value
                self.rejected(f.verify, f.make_bundle(certificates=certs))
        certs = copy.deepcopy(f.certificates)
        certs["device_sig"]["publicJwk"] = f.root_public
        certs["device_sig"]["keyId"] = f.root_id
        self.rejected(f.verify, f.make_bundle(certificates=certs))
        certs = copy.deepcopy(f.certificates)
        certs["device_enc"]["publicJwk"]["d"] = "private_field_is_rejected"
        self.rejected(f.verify, f.make_bundle(certificates=certs))
        certs = copy.deepcopy(f.certificates)
        certs["A1_enc"]["certificateId"] = certs["A1_sig"]["certificateId"]
        self.rejected(f.verify, f.make_bundle(certificates=certs))

    def test_registry_authenticates_entry_payloads_and_active_revocation_flags(self):
        f = self.f
        bundle = copy.deepcopy(f.bundle)
        bundle["entries"][0]["active"] = False
        self.rejected(f.verify, bundle, codes={"key_authorization_required"})
        bundle = f.make_bundle(revoked=("A1_sig",))
        for entry in bundle["entries"]:
            if entry["certificate"] == bundle["entries"][3]["certificate"]:
                entry["active"] = True
        self.rejected(f.verify, bundle)
        self.rejected(
            f.verify,
            f.make_bundle(checkpoint_overrides={"entriesDigest": "0" * 64}),
            codes={"registry_conflict"},
        )
        self.rejected(
            f.verify,
            f.make_bundle(checkpoint_overrides={"issuedAt": 1001}),
            codes={"registry_conflict"},
        )
        bundle = copy.deepcopy(f.bundle)
        bundle["entries"][0]["certificate"] = f.sign(f.certificates["device_sig"], "A1_sig")
        self.rejected(f.verify, bundle, codes={"invalid_signature"})

    def test_registry_rejects_rollback_equivocation_gaps_and_lost_revocations(self):
        f = self.f
        second = f.verify(
            f.make_bundle(previous=f.registry, revoked=("A1_sig",), issued_at=600),
            previous=f.registry,
        )
        self.assertEqual(second.checkpoint_history[1], f.registry.checkpoint_digest)
        self.rejected(f.verify, f.bundle, previous=second, codes={"rollback_detected"})
        self.rejected(
            f.verify,
            f.make_bundle(checkpoint_overrides={"issuedAt": 501}),
            previous=f.registry,
            codes={"registry_conflict"},
        )
        for overrides in ({"previousDigest": "0" * 64}, {"registrySequence": 3}, {"issuedAt": 499}):
            with self.subTest(overrides=overrides):
                self.rejected(
                    f.verify,
                    f.make_bundle(previous=f.registry, checkpoint_overrides=overrides),
                    previous=f.registry,
                    codes={"registry_conflict"},
                )
        self.rejected(
            f.verify, f.make_bundle(previous=second), previous=second, codes={"rollback_detected"}
        )
        third = f.verify(
            f.make_bundle(previous=second, revoked=("A1_sig",), key_epoch=2), previous=second
        )
        self.rejected(
            f.verify,
            f.make_bundle(previous=third, revoked=("A1_sig",)),
            previous=third,
            codes={"rollback_detected"},
        )

    def test_registry_rejects_changed_certificates_and_retains_local_generation_floors(self):
        f = self.f
        certs = copy.deepcopy(f.certificates)
        certs["A1_sig"]["expiresAt"] += 1
        self.rejected(
            f.verify,
            f.make_bundle(previous=f.registry, certificates=certs),
            previous=f.registry,
            codes={"registry_conflict"},
        )
        second = f.verify(
            f.make_bundle(previous=f.registry, revoked=("A1_sig",)), previous=f.registry
        )
        removed = copy.deepcopy(f.certificates)
        del removed["A1_sig"]
        third = f.verify(
            f.make_bundle(previous=second, revoked=("A1_sig",), certificates=removed),
            previous=second,
        )
        f.add_key("A1_sig_replacement", "agent_sig", "A1", "connection_A1", epoch=1)
        certs = copy.deepcopy(f.certificates)
        del certs["A1_sig"]
        self.rejected(
            f.verify,
            f.make_bundle(previous=third, revoked=("A1_sig",), certificates=certs),
            previous=third,
            codes={"stale_key_epoch"},
        )
        f.certificates["A1_sig_replacement"]["keyEpoch"] = 2
        certs = copy.deepcopy(f.certificates)
        del certs["A1_sig"]
        accepted = f.verify(
            f.make_bundle(previous=third, revoked=("A1_sig",), certificates=certs), previous=third
        )
        self.assertEqual(accepted.cert(f.kid("A1_sig_replacement"), now=1000)["keyEpoch"], 2)

    def test_active_keys_must_match_the_current_local_generation(self):
        f = self.f
        f.add_key("A1_sig_next", "agent_sig", "A1", "connection_A1", epoch=1)
        self.rejected(f.verify, f.make_bundle(), codes={"stale_key_epoch"})
        f.certificates["A1_sig_next"]["keyEpoch"] = 2
        changed = f.verify(f.make_bundle(previous=f.registry), previous=f.registry)
        self.rejected(changed.cert, f.kid("A1_sig"), now=1000, codes={"key_authorization_required"})
        self.assertEqual(changed.cert(f.kid("A1_sig_next"), now=1000)["keyEpoch"], 2)
        self.assertEqual(changed.cert(f.kid("A2_sig"), now=1000)["keyEpoch"], 1)

    def test_certificate_validity_and_role_are_checked_at_every_use(self):
        f = self.f
        for kwargs in (
            {"now": 99},
            {"now": 5000},
            {"now": True},
            {"now": 1000, "role": "device_sig"},
            {"now": 1000, "connection_id": "connection_A2"},
        ):
            with self.subTest(kwargs=kwargs):
                self.rejected(f.registry.cert, f.kid("A1_sig"), **kwargs)
        self.rejected(f.registry.cert, f.root_id, now=1000)

    def test_root_generation_is_explicitly_pinned_and_never_silently_rebound(self):
        f = self.f
        bundle = f.make_bundle(checkpoint_overrides={"rootEpoch": 2})
        self.rejected(f.verify, bundle, codes={"untrusted_key"})
        # New trust must be independently established; a login cannot advance this anchor.
        trusted_second = f.verify(bundle, root_epoch=2)
        next_bundle = f.make_bundle(previous=trusted_second, checkpoint_overrides={"rootEpoch": 2})
        self.assertEqual(f.verify(next_bundle, previous=trusted_second).root_epoch, 2)
        self.rejected(
            f.verify, next_bundle, previous=f.registry, root_epoch=2, codes={"untrusted_key"}
        )

    def test_grant_binds_user_agent_task_authorization_and_resource_scope(self):
        f = self.f
        self.assertIsInstance(f.verify_grant(), VerifiedGrant)
        for field, value in (
            ("ownerSubject", "owner_B"),
            ("vaultId", "vault_B"),
            ("authorizationId", "authorization_other"),
            ("connectionId", "connection_A2"),
            ("taskId", "task_A2"),
            ("deviceSigningKeyId", f.kid("A1_sig")),
            ("grantId", "grant_other"),
            ("taskVersions", [2]),
            ("executionEpoch", 2),
            ("grantEpoch", 2),
            ("agentSigningKeyId", f.kid("A2_sig")),
            ("agentEncryptionKeyId", f.kid("A2_enc")),
            ("agentSigningKeyEpoch", 2),
            ("agentEncryptionKeyEpoch", 2),
            ("keyEpoch", 2),
            ("registrySequence", 2),
            ("checkpointDigest", "f" * 64),
        ):
            with self.subTest(field=field):
                self.rejected(f.verify_grant, f.grant(**{field: value}))
        other_ref = f.binding()
        other_ref["ref"]["resourceId"] = "holdings_B"
        self.rejected(f.verify_grant, f.grant(resourceBindings=[other_ref]))
        self.rejected(f.verify_grant, signed=f.sign(f.grant(), "A1_sig"))
        self.rejected(f.verify_grant, signed=f.sign(f.grant(), "root"))
        self.rejected(f.verify_grant, owner_subject="owner_B")

    def test_grant_uses_current_relevant_keys_without_blocking_another_agent(self):
        f = self.f
        original_a1, original_a2 = f.grant(), f.grant("A2")
        second = f.verify(
            f.make_bundle(previous=f.registry, revoked=("A1_sig", "A1_enc")), previous=f.registry
        )
        self.rejected(
            f.verify_grant, original_a1, registry=second, codes={"key_authorization_required"}
        )
        self.assertEqual(
            f.verify_grant(original_a2, agent="A2", registry=second)["taskId"], "task_A2"
        )
        # A directory loaded without the issuing checkpoint cannot prove an older reference.
        fresh_second = f.verify(f.make_bundle(previous=f.registry, revoked=("A1_sig", "A1_enc")))
        self.rejected(
            f.verify_grant,
            original_a2,
            agent="A2",
            registry=fresh_second,
            codes={"rollback_detected"},
        )
        for revoked in (("device_sig",), ("device_enc",), ("recovery_enc",)):
            with self.subTest(revoked=revoked):
                changed = f.verify(
                    f.make_bundle(previous=f.registry, revoked=revoked), previous=f.registry
                )
                self.rejected(f.verify_grant, original_a1, registry=changed)

    def test_grant_expiry_is_bounded_by_authorization_and_all_required_certificates(self):
        f = self.f
        for changes in (
            {"notBefore": 1001},
            {"expiresAt": 1000},
            {"expiresAt": 2001},
            {"expiresAt": 5001},
            {"notBefore": 99},
            {"notBefore": 0, "expiresAt": 2_592_001},
        ):
            with self.subTest(changes=changes):
                self.rejected(f.verify_grant, f.grant(**changes))
        self.rejected(f.verify_grant, authorization_expires_at=1499)
        for name in ("device_sig", "A1_sig", "A1_enc", "device_enc", "recovery_enc"):
            with self.subTest(name=name):
                certs = copy.deepcopy(f.certificates)
                certs[name]["expiresAt"] = 1400
                limited = f.verify(f.make_bundle(certificates=certs))
                self.rejected(
                    f.verify_grant,
                    f.grant(checkpointDigest=limited.checkpoint_digest),
                    registry=limited,
                )

    def test_grant_has_a_hard_thirty_day_ceiling_even_with_longer_certificates(self):
        f = self.f
        certs = copy.deepcopy(f.certificates)
        for cert in certs.values():
            cert["expiresAt"] = 3_000_000
        reg = f.verify(f.make_bundle(certificates=certs))
        payload = f.grant(checkpointDigest=reg.checkpoint_digest, expiresAt=900 + MAX_GRANT_SECONDS)
        self.assertEqual(
            f.verify_grant(payload, registry=reg, authorization_expires_at=3_000_000)["expiresAt"],
            900 + MAX_GRANT_SECONDS,
        )
        self.rejected(
            f.verify_grant,
            payload | {"expiresAt": payload["expiresAt"] + 1},
            registry=reg,
            authorization_expires_at=3_000_000,
            codes={"key_authorization_required"},
        )

    def test_grant_requires_both_agent_roles_to_represent_the_same_principal(self):
        f = self.f
        certs = copy.deepcopy(f.certificates)
        certs["A1_enc"]["principalId"] = "different_agent"
        reg = f.verify(f.make_bundle(certificates=certs))
        self.rejected(
            f.verify_grant,
            f.grant(checkpointDigest=reg.checkpoint_digest),
            registry=reg,
            codes={"key_authorization_required"},
        )

    def test_grant_requires_a_device_grant_capability_and_device_recovery_recipients(self):
        f = self.f
        certs = copy.deepcopy(f.certificates)
        certs["device_sig"]["capabilities"].remove("task_grant")
        restricted = f.verify(f.make_bundle(certificates=certs))
        self.rejected(
            f.verify_grant,
            f.grant(checkpointDigest=restricted.checkpoint_digest),
            registry=restricted,
            codes={"key_authorization_required"},
        )
        for ids in (
            [f.kid("device_enc"), f.kid("A1_enc")],
            [f.kid("device_sig"), f.kid("recovery_enc")],
            [f.kid("A1_enc"), f.kid("recovery_enc")],
        ):
            with self.subTest(ids=ids):
                self.rejected(f.verify_grant, f.grant(writebackRecipientKeyIds=sorted(ids)))
        self.rejected(
            f.verify_grant,
            f.grant(writebackRecipientKeyIds=list(reversed(f.grant()["writebackRecipientKeyIds"]))),
        )
        binding = f.binding()
        self.rejected(f.verify_grant, f.grant(resourceBindings=[binding, binding]))
        self.rejected(f.verify_grant, f.grant(taskVersions=[2, 1]))
        self.rejected(
            f.verify_grant,
            f.grant(resourceBindings=[dict(binding, selectedVersions=[2, 1])]),
            resource_bindings=None,
        )

    def test_begin_intent_binds_exact_current_task_version_and_envelope(self):
        f = self.f
        self.assertEqual(f.verify_begin()["taskId"], "task_A1")
        grant = f.verify_grant(f.grant(taskVersions=[1, 2]))
        for field, value in (
            ("taskId", "task_A2"),
            ("expectedTaskVersion", 2),
            ("taskEnvelopeFingerprint", "f" * 64),
            ("authorizationId", "authorization_other"),
            ("connectionId", "connection_A2"),
            ("grantId", "grant_other"),
            ("grantEpoch", 2),
            ("executionEpoch", 2),
            ("keyEpoch", 2),
            ("ownerSubject", "owner_B"),
            ("vaultId", "vault_B"),
            ("checkpointDigest", "f" * 64),
            ("registrySequence", 2),
        ):
            with self.subTest(field=field):
                self.rejected(f.verify_begin, f.begin(**{field: value}), grant=grant)
        self.rejected(f.verify_begin, signed=f.sign(f.begin(), "A2_sig"))
        self.rejected(f.verify_begin, signed=f.sign(f.begin(), "device_sig"))
        self.rejected(f.verify_begin, signed=f.sign(f.begin(), "A1_sig", typ="fv-object+jws"))
        self.rejected(
            verify_begin_intent,
            f.sign(f.begin(), "A1_sig"),
            registry=f.registry,
            grant=f.grant(),
            task_envelope_fingerprint="a" * 64,
            resource_versions=f.versions(),
            now=1000,
        )
        self.rejected(f.verify_begin, now=1500)

    def test_begin_intent_enforces_granted_source_incarnation_epoch_and_selected_version(self):
        f = self.f
        for field, value in (
            ("revision", 2),
            ("sourceEpoch", 2),
            ("envelopeFingerprint", "c" * 64),
        ):
            with self.subTest(field=field):
                versions = f.versions()
                versions[0][field] = value
                # A payload differing from the exact frozen versions always fails.
                self.rejected(f.verify_begin, f.begin(resourceVersions=versions))
                if field != "envelopeFingerprint":
                    # Even a caller-selected version cannot exceed the grant's source fence.
                    self.rejected(
                        f.verify_begin,
                        f.begin(resourceVersions=versions),
                        resource_versions=versions,
                    )
        for field in ("resourceId", "incarnation"):
            versions = f.versions()
            versions[0]["ref"][field] = "other"
            self.rejected(
                f.verify_begin, f.begin(resourceVersions=versions), resource_versions=versions
            )
        versions = f.versions() * 2
        self.rejected(
            f.verify_begin, f.begin(resourceVersions=versions), resource_versions=versions
        )
        for capability in ("decrypt_task", "decrypt_resources"):
            caps = [cap for cap in f.grant()["capabilities"] if cap != capability]
            self.rejected(f.verify_begin, grant=f.verify_grant(f.grant(capabilities=caps)))
        certs = copy.deepcopy(f.certificates)
        certs["A1_sig"]["capabilities"].remove("run_request")
        reg = f.verify(f.make_bundle(certificates=certs))
        grant = f.verify_grant(f.grant(checkpointDigest=reg.checkpoint_digest), registry=reg)
        self.rejected(
            f.verify_begin,
            f.begin(checkpointDigest=reg.checkpoint_digest),
            registry=reg,
            grant=grant,
        )

    def test_future_versions_stay_inside_the_granted_source_epoch_and_empty_inputs_work(self):
        f = self.f
        binding = dict(f.binding(), versionAccess="future_within_source_epoch", selectedVersions=[])
        grant = f.verify_grant(f.grant(resourceBindings=[binding]), resource_bindings=[binding])
        versions = f.versions()
        versions[0]["revision"] = 2
        self.assertEqual(
            f.verify_begin(
                f.begin(resourceVersions=versions), grant=grant, resource_versions=versions
            )["resourceVersions"],
            versions,
        )
        empty = f.verify_grant(
            f.grant(resourceBindings=[], capabilities=["decrypt_task"]), resource_bindings=[]
        )
        self.assertEqual(
            f.verify_begin(f.begin(resourceVersions=[]), grant=empty, resource_versions=[])[
                "resourceVersions"
            ],
            [],
        )

    def test_begin_intent_requires_reverification_after_a_registry_change(self):
        f = self.f
        old_grant = f.verify_grant()
        changed = f.verify(
            f.make_bundle(previous=f.registry, revoked=("A2_sig",)), previous=f.registry
        )
        self.rejected(
            f.verify_begin,
            f.begin(**f.registry_ref(changed)),
            registry=changed,
            grant=old_grant,
            codes={"key_authorization_required"},
        )
        current_grant = f.verify_grant(registry=changed)
        self.assertEqual(
            f.verify_begin(
                f.begin(**f.registry_ref(changed)), registry=changed, grant=current_grant
            )["taskId"],
            "task_A1",
        )

    def test_retained_begin_intent_requires_known_checkpoint_and_current_authority(self):
        f = self.f
        original_intent = f.begin()
        changed_bundle = f.make_bundle(previous=f.registry, revoked=("A2_sig",))
        changed = f.verify(changed_bundle, previous=f.registry)
        current_grant = f.verify_grant(registry=changed)
        self.rejected(
            f.verify_begin,
            original_intent,
            registry=changed,
            grant=current_grant,
            codes={"rollback_detected"},
        )
        self.assertEqual(
            f.verify_begin(
                original_intent,
                registry=changed,
                grant=current_grant,
                require_current_checkpoint=False,
            )["registrySequence"],
            1,
        )
        self.rejected(
            f.verify_begin,
            original_intent,
            registry=changed,
            grant=current_grant,
            require_current_checkpoint=False,
            now=1500,
            codes={"key_authorization_required"},
        )
        self.rejected(
            f.verify_begin,
            f.begin(taskId="task_A2"),
            registry=changed,
            grant=current_grant,
            require_current_checkpoint=False,
            codes={"recipient_binding_mismatch"},
        )
        self.rejected(
            f.verify_begin,
            original_intent,
            registry=changed,
            grant=current_grant,
            require_current_checkpoint="false",
            codes={"malformed_request"},
        )
        # Fresh loading the new directory does not authenticate its unknown predecessor.
        fresh_changed = f.verify(changed_bundle)
        new_issuance = f.grant(**f.registry_ref(fresh_changed))
        fresh_grant = f.verify_grant(new_issuance, registry=fresh_changed)
        self.rejected(
            f.verify_begin,
            original_intent,
            registry=fresh_changed,
            grant=fresh_grant,
            require_current_checkpoint=False,
            codes={"rollback_detected"},
        )

    def test_controls_require_current_device_authority_and_exact_compare_and_swap(self):
        f = self.f
        self.assertTrue(f.verify_command()["parameters"]["read"])
        for field, value in (
            ("targetId", "result_A2"),
            ("expectedVersion", 2),
            ("expectedSourceEpoch", 2),
            ("ownerSubject", "owner_B"),
            ("vaultId", "vault_B"),
            ("parameters", {"read": False}),
            ("action", "source_delete"),
            ("keyEpoch", 2),
            ("registrySequence", 2),
            ("checkpointDigest", "f" * 64),
        ):
            with self.subTest(field=field):
                self.rejected(f.verify_command, f.command(**{field: value}))
        for signer in ("A1_sig", "root", "device_enc"):
            self.rejected(f.verify_command, signed=f.sign(f.command(), signer))
        self.rejected(f.verify_command, f.command(parameters={"read": True, "raw": "not_allowed"}))
        certs = copy.deepcopy(f.certificates)
        certs["device_sig"]["capabilities"].remove("control_write")
        reg = f.verify(f.make_bundle(certificates=certs))
        self.rejected(f.verify_command, f.command(**f.registry_ref(reg)), registry=reg)

    def test_resource_fence_commands_bind_the_full_resource_and_target(self):
        f = self.f
        params = {"resourceRef": f.resource}
        payload = f.command(
            action="resource_fence_request",
            targetId="holdings_A",
            expectedVersion=None,
            expectedSourceEpoch=1,
            parameters=params,
        )
        kwargs = {
            "expected_action": "resource_fence_request",
            "expected_target_id": "holdings_A",
            "expected_version": None,
            "expected_source_epoch": 1,
            "expected_parameters": params,
        }
        self.assertEqual(f.verify_command(payload, **kwargs)["targetId"], "holdings_A")
        self.rejected(
            f.verify_command,
            payload | {"targetId": "other"},
            **(kwargs | {"expected_target_id": "other"}),
        )
        self.rejected(f.verify_command, payload | {"parameters": {}}, **kwargs)
        changed = copy.deepcopy(params)
        changed["resourceRef"]["incarnation"] = "old_incarnation"
        self.rejected(f.verify_command, payload | {"parameters": changed}, **kwargs)

    def test_task_state_changes_require_an_exact_next_envelope_commitment(self):
        f = self.f
        payload = (
            f.base("task_transition_intent")
            | f.registry_ref()
            | {
                "stableOperationId": "2123456789abcdef0123456789abcdef",
                "taskId": "task_A1",
                "action": "pause",
                "expectedVersion": 1,
                "nextTaskVersion": 2,
                "nextExecutionEpoch": 2,
                "nextEnvelopeFingerprint": "c" * 64,
            }
        )
        kwargs = {
            "registry": f.registry,
            "task_id": "task_A1",
            "action": "pause",
            "expected_version": 1,
            "next_task_version": 2,
            "next_execution_epoch": 2,
            "next_envelope_fingerprint": "c" * 64,
            "now": 1000,
        }
        self.assertEqual(verify_task_transition(f.sign(payload), **kwargs)["nextTaskVersion"], 2)
        for field, value in (
            ("taskId", "task_A2"),
            ("action", "resume"),
            ("expectedVersion", 2),
            ("nextTaskVersion", 3),
            ("nextExecutionEpoch", 1),
            ("nextEnvelopeFingerprint", "d" * 64),
        ):
            with self.subTest(field=field):
                self.rejected(verify_task_transition, f.sign(payload | {field: value}), **kwargs)
        self.rejected(
            verify_task_transition,
            f.sign(payload | {"nextTaskVersion": 3}),
            **(kwargs | {"next_task_version": 3}),
        )
        self.rejected(
            f.verify_command,
            f.command(action="task_pause", parameters={}),
            expected_action="task_pause",
            expected_parameters={},
        )

    def test_resource_scope_requires_exact_connection_epoch_and_selected_incarnations(self):
        f = self.f
        payload = (
            f.base("resource_scope_command")
            | f.registry_ref()
            | {
                "stableOperationId": "3123456789abcdef0123456789abcdef",
                "connectionId": "connection_A1",
                "expectedSourceEpoch": 1,
                "selectedResourceRefs": [f.resource],
            }
        )
        kwargs = {
            "registry": f.registry,
            "connection_id": "connection_A1",
            "expected_source_epoch": 1,
            "selected_resource_refs": [f.resource],
            "now": 1000,
        }
        self.assertEqual(
            verify_resource_scope(f.sign(payload), **kwargs)["connectionId"], "connection_A1"
        )
        for field, value in (
            ("connectionId", "connection_A2"),
            ("expectedSourceEpoch", 2),
            ("selectedResourceRefs", [f.resource, f.resource]),
        ):
            with self.subTest(field=field):
                self.rejected(verify_resource_scope, f.sign(payload | {field: value}), **kwargs)
        self.rejected(verify_resource_scope, f.sign(payload, "A1_sig"), **kwargs)
        changed = dict(f.resource, incarnation="old_incarnation")
        self.rejected(
            verify_resource_scope, f.sign(payload | {"selectedResourceRefs": [changed]}), **kwargs
        )


if __name__ == "__main__":
    unittest.main()
