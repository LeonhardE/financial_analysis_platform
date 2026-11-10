"""Cloud immutable-object boundaries and explicit code/identity transition semantics."""

from unittest.mock import Mock

from fixtures import Fixture
from google.api_core.exceptions import PreconditionFailed
from jwcrypto import jwk

from app.config import Config
from app.contracts import Stopped, clone, digest
from app.provision import EnrollmentObjects
from app.state import GCSSnapshots, public, seal, unseal
from folioview_shared.encrypted.crypto import jwk_thumbprint, sign_jws
from folioview_shared.encrypted.jsonutil import canonical_json


class CloudAndTransitionTests(Fixture):
    def test_gcs_reads_only_requested_current_digest_and_captured_generation(self):
        packet = self.snapshots.read(self.head)
        raw = canonical_json(packet)
        calls = []
        blob = Mock()
        blob.size = len(raw)
        blob.generation = 77

        def download(**kw):
            calls.append(kw)
            return raw

        blob.download_as_bytes.side_effect = download
        bucket = Mock()
        bucket.blob.return_value = blob
        client = Mock()
        client.bucket.return_value = bucket
        store = GCSSnapshots(self.value["snapshotBucket"], client=client)
        self.assertEqual(store.read(self.head), packet)
        bucket.blob.assert_called_once_with("executor-state/" + self.head + ".json")
        self.assertEqual(calls[0]["if_generation_match"], 77)
        self.assertEqual(calls[0]["checksum"], "crc32c")
        self.assertIsNone(calls[0]["retry"])
        blob.download_as_bytes.return_value = b"{}"
        blob.download_as_bytes.side_effect = None
        with self.assertRaises(Stopped):
            store.read(self.head)
        blob.size = 2097153
        with self.assertRaises(Stopped):
            store.read(self.head)
        bucket.list_blobs.assert_not_called()

    def test_gcs_upload_is_create_only_and_existing_ciphertext_must_match(self):
        packet = self.snapshots.read(self.head)
        raw = canonical_json(packet)
        blob = Mock()
        blob.size = len(raw)
        blob.generation = 77
        blob.download_as_bytes.return_value = raw
        bucket = Mock()
        bucket.blob.return_value = blob
        client = Mock()
        client.bucket.return_value = bucket
        store = GCSSnapshots(self.value["snapshotBucket"], client=client)
        self.assertEqual(store.put(packet), self.head)
        self.assertEqual(blob.upload_from_string.call_args.kwargs["if_generation_match"], 0)
        blob.upload_from_string.side_effect = PreconditionFailed("synthetic collision")
        self.assertEqual(store.put(packet), self.head)
        blob.download_as_bytes.return_value = b"{}"
        with self.assertRaises(Stopped):
            store.put(packet)
        blob.delete.assert_not_called()

    def test_creation_namespace_cannot_replace_enrollment_tombstone(self):
        client = Mock()
        objects = EnrollmentObjects(self.value["snapshotBucket"], client=client)
        objects.create("a" * 64 + "-reservation", {"profile": "synthetic"})
        upload = client.bucket.return_value.blob.return_value.upload_from_string
        self.assertEqual(upload.call_args.kwargs["if_generation_match"], 0)
        self.assertIsNone(upload.call_args.kwargs["retry"])
        upload.side_effect = PreconditionFailed("already reserved")
        with self.assertRaises(PreconditionFailed):
            objects.create("a" * 64 + "-reservation", {"profile": "changed"})

    def next_config(self, kind):
        value = clone(self.value)
        value["workload"]["imageDigest"] = "sha256:" + "e" * 64
        value["binding"]["workloadDigest"] = digest(value["workload"])
        if kind == "epoch_migration":
            value["binding"]["identityEpoch"] += 1
            for _name, field, keyfield in [
                ("signing", "agentSigningJwk", "agentSigningKeyId"),
                ("encryption", "agentEncryptionJwk", "agentEncryptionKeyId"),
            ]:
                key = jwk.JWK.generate(kty="EC", crv="P-256")
                value[field] = public(key)
                value["binding"][keyfield] = jwk_thumbprint(public(key))
        approval = __import__(
            "folioview_shared.encrypted.crypto", fromlist=["verify_jws"]
        ).verify_jws(value["approval"], value["rootJwk"], typ="fv-control+jws")
        approval["binding"] = value["binding"]
        value["approval"] = sign_jws(approval, self.keys["root"], typ="fv-control+jws")
        return Config.parse(value, now=self.now)

    def test_root_approved_code_upgrade_preserves_original_encrypted_keyring(self):
        next_config = self.next_config("code_upgrade")
        packet = self.snapshots.read(self.head)
        self.assertEqual(unseal(packet, self.dek, next_config.binding)["keys"], self.state["keys"])
        self.authority.config = next_config
        runtime = self.new_runtime(next_config)
        restored = runtime.restore()
        self.assertEqual(restored["agentSigningJwk"], self.value["agentSigningJwk"])
        self.assertEqual(restored["tlsJwk"], self.value["tlsJwk"])

    def test_explicit_new_epoch_cannot_relabel_old_encrypted_identity(self):
        migrated = self.next_config("epoch_migration")
        with self.assertRaises(Stopped):
            unseal(self.snapshots.read(self.head), self.dek, migrated.binding)
        self.authority.config = migrated
        with self.assertRaises(Stopped):
            self.new_runtime(migrated).restore()
        self.assertEqual(len(list(self.snapshots.directory.glob("*.json"))), 1)

    def test_wrong_private_scalar_or_encryption_state_cannot_masquerade_as_original_keys(self):
        value = clone(self.state)
        other = jwk.JWK.generate(kty="EC", crv="P-256").export(private_key=True, as_dict=True)
        value["keys"]["tls"]["d"] = other["d"]
        with self.assertRaises(Stopped):
            seal(value, self.dek, self.config.binding)
