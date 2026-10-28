"""Durable owner enrollment, immutable pins, directory CAS and source isolation."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture

from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vaults import MAX_SOURCES, VaultService
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "hub.sqlite3"
        self.service = VaultService(SQLiteHubStore(self.path), clock=lambda: 1000)
        self.f = VaultFixture()

    def code(self, code, action):
        with self.assertRaises(ContractError) as result:
            action()
        self.assertEqual(result.exception.code, code)

    def create(self):
        return self.service.bootstrap(UID, self.f.bootstrap(), BOOT)

    def source(self, source=SOURCE, operation="synthetic_source_create_0001", command=None):
        return self.service.create_source(
            UID,
            self.f.vault,
            source,
            command or self.f.control(source, operation),
            operation,
            self.f.kid("device_sig"),
        )

    def test_opaque_bootstrap_persists_and_exact_replay_never_replaces_archive(self):
        self.assertIsNone(self.service.current(UID)["vault"])
        first = self.create()
        restarted = VaultService(SQLiteHubStore(self.path), clock=lambda: 1000)
        self.assertEqual(first, restarted.current(UID))
        self.assertEqual(first, restarted.bootstrap(UID, self.f.bootstrap(), BOOT))
        self.assertIsNone(restarted.current(OTHER_UID)["vault"])
        changed = self.f.bootstrap()
        changed["archive"]["ciphertext"] = "eA" * 16
        self.code("idempotency_conflict", lambda: restarted.bootstrap(UID, changed, BOOT))
        self.code(
            "version_conflict", lambda: restarted.bootstrap(UID, self.f.bootstrap(), BOOT + "_2")
        )
        self.assertEqual(first, restarted.current(UID))

    def test_parallel_first_enrollment_keeps_one_root_and_does_not_overwrite(self):
        other = VaultFixture(UID)

        def attempt(fixture, operation):
            try:
                return self.service.bootstrap(UID, fixture.bootstrap(), operation)["vault"][
                    "rootKeyId"
                ]
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(
                pool.map(lambda pair: attempt(*pair), [(self.f, BOOT), (other, BOOT + "_2")])
            )
        self.assertEqual(outcomes.count("version_conflict"), 1)
        current = self.service.current(UID)["vault"]
        self.assertIn(current["rootKeyId"], [self.f.root_id, other.root_id])
        self.assertEqual(current["version"], 1)

    def test_private_fields_foreign_owner_archive_and_invalid_first_directory_refused(self):
        for mutate in (
            lambda b: b.update(password="not-accepted"),
            lambda b: b["rootJwk"].update(d="not-a-public-key"),
            lambda b: b["archive"].update(privateKey="not-accepted"),
            lambda b: b["archive"].update(ownerSubject=owner_key(OTHER_UID)),
            lambda b: b["archive"].update(iv="aQ"),
        ):
            body = copy.deepcopy(self.f.bootstrap())
            mutate(body)
            with self.subTest(mutate=mutate), self.assertRaises(ContractError):
                self.service.bootstrap(UID, body, BOOT)
        bad = self.f.bootstrap()
        bad["registryBundle"] = self.f.make_bundle(previous=self.f.registry)
        self.code("registry_conflict", lambda: self.service.bootstrap(UID, bad, BOOT))
        self.assertIsNone(self.service.current(UID)["vault"])

    def test_registry_exact_cas_replay_and_source_preservation(self):
        self.create()
        selected = self.source()["source"]
        bundle = self.f.make_bundle(previous=self.f.registry)
        body = {
            "contractVersion": self.f.bundle["contractVersion"],
            "expectedVersion": 2,
            "registryBundle": bundle,
        }
        result = self.service.update_registry(
            UID, self.f.vault, body, "synthetic_registry_update_0001"
        )
        self.assertEqual(result["vault"]["version"], 3)
        self.assertEqual(result["sources"], [selected])
        self.assertEqual(
            result,
            self.service.update_registry(UID, self.f.vault, body, "synthetic_registry_update_0001"),
        )
        self.assertEqual(result, self.service.bootstrap(UID, self.f.bootstrap(), BOOT))
        self.code(
            "version_conflict",
            lambda: self.service.update_registry(
                UID, self.f.vault, body, "synthetic_registry_update_0002"
            ),
        )
        lower = {**body, "expectedVersion": 3, "registryBundle": self.f.bundle}
        with self.assertRaises(ContractError):
            self.service.update_registry(UID, self.f.vault, lower, "synthetic_registry_rollback")
        self.assertEqual(self.service.current(UID), result)

    def test_registry_substitution_and_removed_revocation_cannot_reset_current_authority(self):
        self.create()
        self.f.add_key("new_sig", "device_sig", "device_new")
        self.f.add_key("new_enc", "device_enc", "device_new")
        next_bundle = self.f.make_bundle(
            previous=self.f.registry, revoked=("device_sig", "device_enc")
        )
        body = {
            "contractVersion": self.f.bundle["contractVersion"],
            "expectedVersion": 1,
            "registryBundle": next_bundle,
        }
        result = self.service.update_registry(UID, self.f.vault, body, "synthetic_registry_revoke")
        self.code("key_authorization_required", lambda: self.source())
        next_registry = self.f.verify(next_bundle, previous=self.f.registry)
        restored = self.f.make_bundle(previous=next_registry)
        self.code(
            "rollback_detected",
            lambda: self.service.update_registry(
                UID,
                self.f.vault,
                {**body, "expectedVersion": 2, "registryBundle": restored},
                "synthetic_registry_revive",
            ),
        )
        foreign = VaultFixture(UID)
        with self.assertRaises(ContractError):
            self.service.update_registry(
                UID,
                self.f.vault,
                {
                    **body,
                    "expectedVersion": 2,
                    "registryBundle": foreign.make_bundle(previous=foreign.registry),
                },
                "synthetic_root_substitution",
            )
        self.assertEqual(self.service.current(UID), result)

    def test_source_signed_creation_derives_incarnation_and_isolates_owners(self):
        self.create()
        command = self.f.control()
        first = self.source(command=command)
        expected = "inc_" + signing_input_fingerprint(command["command"])[:32]
        self.assertEqual(first["source"]["resourceRef"]["incarnation"], expected)
        self.assertEqual(first, self.source(command=command))
        authority = self.service.authority(UID, SOURCE)["authority"]
        self.assertEqual(authority["ownerSubject"], owner_key(UID))
        self.assertEqual(authority["resourceRef"], first["source"]["resourceRef"])
        self.assertEqual(authority["writerKeyIds"], [self.f.kid("device_sig")])
        self.assertEqual(
            authority["recipientKeyIds"],
            sorted([self.f.kid("device_enc"), self.f.kid("recovery_enc")]),
        )
        self.assertNotIn("archive", authority)
        self.code("not_found", lambda: self.service.authority(OTHER_UID, SOURCE))
        foreign = VaultFixture(OTHER_UID)
        self.service.bootstrap(OTHER_UID, foreign.bootstrap(), BOOT)
        self.code("not_found", lambda: self.service.authority(OTHER_UID, SOURCE))
        self.code("version_conflict", lambda: self.source(operation="synthetic_source_recreate"))

    def test_source_rejects_unsigned_owner_scope_action_or_operation_substitution(self):
        self.create()
        for changes in (
            {"ownerSubject": owner_key(OTHER_UID)},
            {"expectedVersion": 1},
            {"parameters": {"scope": "all"}},
            {"action": "source_delete"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.source(command=self.f.control(**changes))
        foreign = VaultFixture(UID)
        self.code("invalid_signature", lambda: self.source(command=foreign.control()))
        self.code(
            "idempotency_conflict",
            lambda: self.source(command=self.f.control(operation="synthetic_other_operation")),
        )
        self.assertEqual(self.service.current(UID)["sources"], [])

    def test_source_count_is_bounded_and_exact_replay_survives_capacity(self):
        self.create()
        original = None
        for index in range(MAX_SOURCES):
            value = self.source(
                source=f"holdings_{index}", operation=f"synthetic_source_create_{index:04}"
            )
            original = original or value
        self.code(
            "version_conflict", lambda: self.source(operation="synthetic_over_capacity_source")
        )
        self.assertEqual(
            original, self.source(source="holdings_0", operation="synthetic_source_create_0000")
        )

    def test_corrupted_persisted_binding_and_history_cannot_become_public_authority(self):
        self.create()
        self.source()
        path = document_path("hub_vaults", owner_key(UID))
        self.service.store.transact(
            lambda unit: unit.put(path, {**unit.get(path), "ownerSubject": owner_key(OTHER_UID)})
        )
        with self.assertRaises(StoreUnavailable):
            self.service.authority(UID, SOURCE)
