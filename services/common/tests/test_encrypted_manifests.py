"""Signed synthetic Run/manifest/component bindings; no network or persisted keys."""

import copy
import unittest
from dataclasses import replace
from datetime import UTC, datetime

from test_encrypted_authority import AuthorityFixture
from test_encrypted_schema import context_for, wrapper

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    decrypt_jwe,
    encrypt_jwe,
    sign_jws,
    signing_input_fingerprint,
)
from folioview_shared.encrypted.envelope import manifest_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.manifests import (
    ManifestExpectation,
    validate_component_page,
    validate_run_descriptor,
    verify_component_author,
    verify_manifest,
)


def timestamp(seconds):
    return datetime.fromtimestamp(seconds, UTC).isoformat().replace("+00:00", "Z")


class ManifestFixture(AuthorityFixture):
    def __init__(self, resources=1, agent="A1", grant_expires_at=1500, **kwargs):
        super().__init__(**kwargs)
        self.agent = agent
        if grant_expires_at > 1500:
            for certificate in self.certificates.values():
                certificate["expiresAt"] = grant_expires_at + 1000
            self.registry = self.verify(self.make_bundle())
        refs = [copy.deepcopy(self.resource)] if resources else []
        if resources == 2:
            refs.append(
                {
                    "kind": "watchlist",
                    "sourceService": "user",
                    "resourceId": "watchlist_A",
                    "incarnation": "incarnation_A",
                }
            )
        self.bindings = [
            {"ref": ref, "sourceEpoch": 1, "versionAccess": "selected", "selectedVersions": [1]}
            for ref in refs
        ]
        payload = self.grant(agent, resourceBindings=self.bindings, expiresAt=grant_expires_at)
        self.verified_grant = self.verify_grant(
            payload,
            agent=agent,
            resource_bindings=self.bindings,
            authorization_expires_at=max(2000, grant_expires_at + 100),
        )
        self.task_carrier = self.make_carrier("task", "task_" + agent)
        self.resource_carriers = []
        for index, ref in enumerate(refs):
            kind = "holdings_snapshot" if ref["kind"] == "holdings" else "watchlist_evidence"
            self.resource_carriers.append(self.make_carrier(kind, "resource_" + str(index), ref))
        task_reference = self.reference(self.task_carrier)
        entries = []
        selected = []
        for ref, carrier in zip(refs, self.resource_carriers, strict=True):
            entry = self.reference(carrier) | {"ref": ref, "sourceEpoch": 1}
            entries.append(entry)
            selected.append(
                {
                    field: entry[field]
                    for field in ("ref", "revision", "sourceEpoch", "envelopeFingerprint")
                }
            )
        intent = self.begin(
            agent,
            taskEnvelopeFingerprint=task_reference["envelopeFingerprint"],
            resourceVersions=selected,
        )
        self.signed_begin = self.sign(intent, agent + "_sig")
        begin_fingerprint = signing_input_fingerprint(self.signed_begin)
        self.expectation = ManifestExpectation(
            self.owner,
            self.vault,
            "run_" + agent,
            "manifest_" + agent,
            "result_" + agent,
            begin_fingerprint,
        )
        self.run = {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": self.vault,
            "runId": "run_" + agent,
            "taskId": "task_" + agent,
            "taskVersion": 1,
            "executionEpoch": 1,
            "connectionId": "connection_" + agent,
            "grantId": "grant_" + agent,
            "grantEpoch": 1,
            "authorizationId": "authorization_" + agent,
            "keyEpoch": 1,
            "state": "ready",
            "manifestId": "manifest_" + agent,
            "initialResultId": "result_" + agent,
            "beginIntentFingerprint": begin_fingerprint,
            "createdAt": timestamp(950),
            "expiresAt": timestamp(1400),
        }
        self.manifest = {
            field: self.run[field]
            for field in (
                "contractVersion",
                "vaultId",
                "runId",
                "taskId",
                "taskVersion",
                "connectionId",
                "grantId",
                "grantEpoch",
                "executionEpoch",
                "keyEpoch",
                "beginIntentFingerprint",
                "expiresAt",
            )
        } | {
            "manifestId": "manifest_" + agent,
            "signedBeginIntent": self.signed_begin,
            "taskEnvelope": task_reference,
            "entries": entries,
            "createdAt": timestamp(980),
        }

    def make_carrier(self, kind, object_id, ref=None):
        context = context_for(kind)
        context.update(
            ownerSubject=self.owner,
            vaultId=self.vault,
            rootKeyId=self.root_id,
            rootEpoch=self.registry.root_epoch,
            registrySequence=self.registry.registry_sequence,
            checkpointDigest=self.registry.checkpoint_digest,
            keyEpoch=self.registry.key_epoch,
            authorSigningKeyId=self.kid("device_sig"),
            objectId=object_id,
        )
        if kind == "task":
            context["binding"].update(taskId=object_id, taskVersion=1)
            context["resourceBindings"] = [
                {"ref": binding["ref"], "sourceEpoch": binding["sourceEpoch"]}
                for binding in self.bindings
            ]
        else:
            context["binding"].update(resourceRef=ref, sourceRevision=1, sourceEpoch=1)
        names = ["device_enc", "recovery_enc", self.agent + "_enc"]
        context["recipients"] = sorted(
            [
                {
                    field: self.certificates[name][field]
                    for field in ("keyId", "role", "principalId", "connectionId", "keyEpoch")
                }
                for name in names
            ],
            key=lambda row: row["keyId"],
        )
        recipients = {self.kid(name): self.public(self.keys[name]) for name in names}
        encrypted = encrypt_jwe(wrapper(context), recipients, context=context)
        signed = self.sign({"context": context, "jwe": encrypted}, typ="fv-object+jws")
        return {"contractVersion": CONTRACT_VERSION, "signedObject": signed}

    @staticmethod
    def reference(carrier):
        from folioview_shared.encrypted.crypto import _signed_parts

        _, message = _signed_parts(carrier["signedObject"])
        context = message["context"]
        return {
            field: context[field]
            for field in ("objectId", "objectType", "revision", "deliveryRevision", "keyEpoch")
        } | {"envelopeFingerprint": signing_input_fingerprint(carrier["signedObject"])}

    def verify_manifest(self, manifest=None, run=None, **kwargs):
        arguments = {
            "registry": self.registry,
            "grant": self.verified_grant,
            "expectation": self.expectation,
            "now": 1000,
        }
        arguments.update(kwargs)
        return verify_manifest(
            self.manifest if manifest is None else manifest,
            self.run if run is None else run,
            **arguments,
        )

    def page(self, index, manifest=None):
        descriptor = self.manifest if manifest is None else manifest
        carrier = self.task_carrier if index == 0 else self.resource_carriers[index - 1]
        reference = descriptor["taskEnvelope"] if index == 0 else descriptor["entries"][index - 1]
        return {
            "contractVersion": CONTRACT_VERSION,
            "manifest": descriptor,
            "manifestFingerprint": manifest_fingerprint(descriptor),
            "componentIndex": index,
            "component": {
                "kind": "task" if index == 0 else "resource",
                "objectId": reference["objectId"],
                "revision": reference["revision"],
                "deliveryRevision": reference["deliveryRevision"],
                "signedObject": carrier["signedObject"],
            },
            "nextCursor": "opaque_cursor" if index < len(descriptor["entries"]) else None,
        }


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.f = ManifestFixture()

    def rejected(self, function, *args, **kwargs):
        with self.assertRaises(ContractError) as caught:
            function(*args, **kwargs)
        self.assertNotIn("Synthetic", str(caught.exception))
        return caught.exception

    def test_complete_manifest_binds_agent_intent_and_decryptable_original_components(self):
        f = self.f
        verified = f.verify_manifest()
        self.assertEqual(verified.fingerprint, manifest_fingerprint(f.manifest))
        self.assertEqual(verified.run, f.run)
        for index in range(2):
            component = validate_component_page(
                f.page(index), manifest=verified, expected_index=index
            )
            message = verify_component_author(
                component,
                author_public_jwk=f.public(f.keys["device_sig"]),
                expected_author_key_id=f.kid("device_sig"),
            )
            plaintext = decrypt_jwe(message["jwe"], f.keys["A1_enc"], context=component.context)
            self.assertEqual(plaintext["objectId"], component.context["objectId"])

    def test_zero_resource_and_two_resource_selections_keep_exact_component_order(self):
        for count in (0, 2):
            with self.subTest(count=count):
                f = ManifestFixture(resources=count)
                verified = f.verify_manifest()
                for index in range(count + 1):
                    validate_component_page(f.page(index), manifest=verified, expected_index=index)

    def test_verified_snapshots_cannot_be_changed_by_mutating_input_or_properties(self):
        f = self.f
        verified = f.verify_manifest()
        original = verified.manifest
        f.manifest["entries"][0]["revision"] = 9
        mutable = verified.manifest
        mutable["entries"].clear()
        self.assertEqual(verified.manifest, original)
        page = f.page(0, manifest=original)
        component = validate_component_page(page, manifest=verified, expected_index=0)
        context = component.context
        context["ownerSubject"] = "owner_B"
        page["component"]["signedObject"]["signature"] = "A" * 86
        self.assertEqual(component.context["ownerSubject"], f.owner)
        self.assertNotEqual(component.carrier["signedObject"]["signature"], "A" * 86)

    def test_all_independent_route_and_begin_operation_pins_are_required(self):
        f = self.f
        for field, value in (
            ("owner_subject", "owner_B"),
            ("vault_id", "vault_B"),
            ("run_id", "run_B"),
            ("manifest_id", "manifest_B"),
            ("initial_result_id", "result_B"),
            ("begin_intent_fingerprint", "f" * 64),
        ):
            with self.subTest(field=field):
                self.rejected(
                    f.verify_manifest, expectation=replace(f.expectation, **{field: value})
                )

    def test_run_and_manifest_task_connection_grant_epochs_and_identity_are_exact(self):
        f = self.f
        for field, value in (
            ("taskId", "task_A2"),
            ("taskVersion", 2),
            ("connectionId", "connection_A2"),
            ("grantId", "grant_A2"),
            ("grantEpoch", 2),
            ("executionEpoch", 2),
            ("keyEpoch", 2),
            ("runId", "run_A2"),
            ("vaultId", "vault_B"),
        ):
            for target in ("run", "manifest"):
                with self.subTest(field=field, target=target):
                    run, manifest = copy.deepcopy(f.run), copy.deepcopy(f.manifest)
                    (run if target == "run" else manifest)[field] = value
                    self.rejected(f.verify_manifest, manifest, run)
        run = copy.deepcopy(f.run)
        run["authorizationId"] = "authorization_A2"
        self.rejected(f.verify_manifest, run=run)

    def test_current_registry_grant_and_correct_agent_signature_are_required(self):
        f = self.f
        other = AuthorityFixture("owner_B", "vault_B")
        self.rejected(f.verify_manifest, registry=other.registry)
        self.rejected(f.verify_manifest, grant=f.verify_grant(agent="A2"))
        newer = f.verify(f.make_bundle(previous=f.registry), previous=f.registry)
        self.rejected(f.verify_manifest, registry=newer)
        self.rejected(f.verify_manifest, grant=f.grant())
        manifest = copy.deepcopy(f.manifest)
        manifest["signedBeginIntent"] = f.sign(f.begin(), "A2_sig")
        self.rejected(f.verify_manifest, manifest)

    def test_unrelated_A1_revocation_preserves_A2_retained_manifest_but_relevant_revoke_fails(self):
        f = ManifestFixture(agent="A2")
        newer = f.verify(
            f.make_bundle(previous=f.registry, revoked=("A1_sig", "A1_enc")),
            previous=f.registry,
        )
        current_grant = f.verify_grant(
            f.verified_grant.as_dict(),
            agent="A2",
            registry=newer,
            resource_bindings=f.bindings,
        )
        verified = f.verify_manifest(registry=newer, grant=current_grant)
        for index in range(2):
            component = validate_component_page(
                f.page(index), manifest=verified, expected_index=index
            )
            message = verify_component_author(
                component,
                author_public_jwk=f.public(f.keys["device_sig"]),
                expected_author_key_id=f.kid("device_sig"),
            )
            decrypt_jwe(message["jwe"], f.keys["A2_enc"], context=component.context)
        relevant = f.verify(
            f.make_bundle(previous=newer, revoked=("A1_sig", "A1_enc", "A2_sig", "A2_enc")),
            previous=newer,
        )
        self.rejected(
            f.verify_grant,
            f.verified_grant.as_dict(),
            agent="A2",
            registry=relevant,
            resource_bindings=f.bindings,
        )
        self.rejected(f.verify_manifest, registry=relevant, grant=current_grant)

    def test_exact_signed_task_fingerprint_and_resource_versions_cannot_be_replaced(self):
        f = self.f
        for target, field, value in (
            ("taskEnvelope", "envelopeFingerprint", "f" * 64),
            ("taskEnvelope", "revision", 2),
            ("entries", "envelopeFingerprint", "f" * 64),
            ("entries", "revision", 2),
            ("entries", "sourceEpoch", 2),
            ("entries", "objectType", "watchlist_evidence"),
        ):
            with self.subTest(target=target, field=field):
                manifest = copy.deepcopy(f.manifest)
                item = manifest[target][0] if target == "entries" else manifest[target]
                item[field] = value
                self.rejected(f.verify_manifest, manifest)
        manifest = copy.deepcopy(f.manifest)
        manifest["entries"].append(copy.deepcopy(manifest["entries"][0]))
        manifest["entries"][1]["objectId"] = "same_ref_other_object"
        self.rejected(f.verify_manifest, manifest)

    def test_lifetime_is_current_bounded_and_cannot_outlive_run_or_grant(self):
        f = self.f
        for created, expires, now in (
            (1001, 1400, 1000),
            (950, 950, 1000),
            (950, 1000, 1000),
            (950, 1501, 1000),
            (899, 1400, 1000),
        ):
            with self.subTest(created=created, expires=expires, now=now):
                run = copy.deepcopy(f.run)
                run.update(createdAt=timestamp(created), expiresAt=timestamp(expires))
                self.rejected(f.verify_manifest, run=run, now=now)
        # A long grant does not bypass the independent two-hour Run ceiling.
        long = ManifestFixture(grant_expires_at=10000)
        long.verify_manifest()
        run = copy.deepcopy(long.run)
        run["expiresAt"] = timestamp(8151)
        self.rejected(long.verify_manifest, run=run)
        for field, value in (("createdAt", timestamp(949)), ("expiresAt", timestamp(1401))):
            manifest = copy.deepcopy(long.manifest)
            manifest[field] = value
            self.rejected(long.verify_manifest, manifest)

    def test_run_states_are_metadata_and_do_not_become_execution_permission(self):
        f = self.f
        for state in ("ready", "submitted", "failed", "invalidated", "expired"):
            run = copy.deepcopy(f.run)
            run["state"] = state
            validate_run_descriptor(
                run,
                registry=f.registry,
                grant=f.verified_grant,
                expectation=f.expectation,
                now=1000,
            )
        run = copy.deepcopy(f.run)
        run.update(state="preparing", manifestId=None)
        validate_run_descriptor(
            run, registry=f.registry, grant=f.verified_grant, expectation=f.expectation, now=1000
        )
        self.rejected(f.verify_manifest, run=run)
        run["manifestId"] = f.run["manifestId"]
        self.rejected(f.verify_manifest, run=run)

    def test_component_index_descriptor_cursor_and_reference_cannot_be_mixed(self):
        f = self.f
        verified = f.verify_manifest()
        cases = []
        for field, value in (
            ("componentIndex", 1),
            ("manifestFingerprint", "f" * 64),
            ("nextCursor", None),
        ):
            page = f.page(0)
            page[field] = value
            cases.append(page)
        page = f.page(0)
        page["manifest"] = copy.deepcopy(page["manifest"])
        page["manifest"]["manifestId"] = "manifest_B"
        cases.append(page)
        for field, value in (
            ("kind", "resource"),
            ("objectId", "task_A2"),
            ("revision", 2),
            ("deliveryRevision", 2),
        ):
            page = f.page(0)
            page["component"][field] = value
            cases.append(page)
        for page in cases:
            self.rejected(validate_component_page, page, manifest=verified, expected_index=0)
        self.rejected(validate_component_page, f.page(1), manifest=verified, expected_index=0)
        self.rejected(validate_component_page, f.page(0), manifest=verified, expected_index=True)
        last = f.page(1)
        last["nextCursor"] = "cursor_after_last"
        self.rejected(validate_component_page, last, manifest=verified, expected_index=1)

    def test_component_signature_authentication_is_separate_from_reference_binding(self):
        f = self.f
        verified = f.verify_manifest()
        page = f.page(0)
        page["component"]["signedObject"] = dict(page["component"]["signedObject"])
        # Fingerprints intentionally exclude signature bytes. Structural binding
        # alone must never be presented as an authenticated original author.
        page["component"]["signedObject"]["signature"] = "A" * 86
        component = validate_component_page(page, manifest=verified, expected_index=0)
        self.rejected(
            verify_component_author,
            component,
            author_public_jwk=f.public(f.keys["device_sig"]),
            expected_author_key_id=f.kid("device_sig"),
        )
        component = validate_component_page(f.page(0), manifest=verified, expected_index=0)
        self.rejected(
            verify_component_author,
            component,
            author_public_jwk=f.public(f.keys["A2_sig"]),
            expected_author_key_id=f.kid("device_sig"),
        )

    def test_signed_component_substitution_and_ciphertext_truncation_fail(self):
        f = self.f
        verified = f.verify_manifest()
        page = f.page(0)
        replacement = f.make_carrier("task", "task_A1")
        page["component"]["signedObject"] = replacement["signedObject"]
        self.rejected(validate_component_page, page, manifest=verified, expected_index=0)
        page = f.page(1)
        page["component"]["signedObject"] = f.task_carrier["signedObject"]
        self.rejected(validate_component_page, page, manifest=verified, expected_index=1)
        from folioview_shared.encrypted.crypto import _signed_parts

        _, message = _signed_parts(f.resource_carriers[0]["signedObject"])
        message["jwe"]["ciphertext"] = message["jwe"]["ciphertext"][:-4]
        page = f.page(1)
        page["component"]["signedObject"] = sign_jws(
            message, f.keys["device_sig"], typ="fv-object+jws"
        )
        self.rejected(validate_component_page, page, manifest=verified, expected_index=1)

    def test_other_owner_or_agent_cannot_use_the_component_binding(self):
        f = self.f
        other = ManifestFixture(owner="owner_B", vault="vault_B")
        verified = f.verify_manifest()
        self.rejected(validate_component_page, other.page(0), manifest=verified, expected_index=0)
        component = validate_component_page(f.page(1), manifest=verified, expected_index=1)
        from folioview_shared.encrypted.crypto import _signed_parts

        _, message = _signed_parts(component.carrier["signedObject"])
        for wrong_key in (f.keys["A2_enc"], other.keys["A1_enc"]):
            self.rejected(decrypt_jwe, message["jwe"], wrong_key, context=component.context)


if __name__ == "__main__":
    unittest.main()
