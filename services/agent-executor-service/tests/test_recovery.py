"""Same-key restoration, current authority fences and durable encrypted outbox recovery."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from fixtures import ACCESS, Fixture, public
from jwcrypto import jwk

from app.contracts import Stopped, clone
from app.state import seal, unseal
from folioview_shared.encrypted.jsonutil import b64url_encode


class RecoveryTests(Fixture):
    def test_recovery_retains_all_original_public_keys_without_account_token(self):
        result = self.runtime.restore()
        for name, field in (
            ("signing", "agentSigningJwk"),
            ("encryption", "agentEncryptionJwk"),
            ("tls", "tlsJwk"),
        ):
            self.assertEqual(result[field], public(self.keys[name]))
        self.assertTrue(self.authority.confirmed)
        self.assertTrue(all(p.startswith("/workload/") for p in self.authority.calls))
        self.assertNotIn("access_token", json.dumps(result))
        self.assertNotIn('"d":', json.dumps(result))

    def test_new_runtime_restores_same_keys_and_fences_the_previous_boot(self):
        first = self.runtime.restore()
        second = self.new_runtime()
        self.assertEqual(second.restore(), first)
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", self.operation(), [])
        second.authorize(ACCESS, "execute", self.operation(), [])

    def test_missing_current_snapshot_never_selects_backup_or_generates_new_keys(self):
        old = (self.snapshots.directory / (self.head + ".json")).read_bytes()
        self.authority.head = "f" * 64
        with self.assertRaises(Stopped):
            self.runtime.restore()
        self.assertIsNone(self.runtime.head)
        self.assertIsNone(self.runtime._keys)
        self.assertEqual(
            list(self.snapshots.directory.glob("*.json")),
            [self.snapshots.directory / (self.head + ".json")],
        )
        self.assertEqual((self.snapshots.directory / (self.head + ".json")).read_bytes(), old)

    def test_wrong_dek_tampered_ciphertext_and_wrong_original_keys_stop(self):
        self.authority.dek = b"x" * 32
        with self.assertRaises(Stopped):
            self.runtime.restore()
        self.authority.dek = self.dek
        packet = self.snapshots.read(self.head)
        packet["ciphertext"] = packet["ciphertext"][:-2] + "AA"
        self.authority.head = self.snapshots.put(packet)
        with self.assertRaises(Stopped):
            self.new_runtime().restore()
        different = clone(self.state)
        different["keys"]["signing"] = jwk.JWK.generate(kty="EC", crv="P-256").export(
            private_key=True, as_dict=True
        )
        with self.assertRaises(Stopped):
            seal(different, self.dek, self.config.binding)

    def test_external_state_is_authenticated_ciphertext_only(self):
        raw = (self.snapshots.directory / (self.head + ".json")).read_bytes()
        self.assertNotIn(b'"d"', raw)
        self.assertNotIn(b"synthetic_run", raw)
        self.assertEqual(
            unseal(self.snapshots.read(self.head), self.dek, self.config.binding), self.state
        )

    def test_revocation_outage_and_expired_root_approval_fail_before_any_attestation(self):
        for flag in ["revoked", "unavailable"]:
            setattr(self.authority, flag, True)
            with self.assertRaises(Stopped):
                self.new_runtime().restore()
            setattr(self.authority, flag, False)
        self.assertEqual(self.attestor.statements, [])
        self.now += 86401
        with self.assertRaises(Stopped):
            self.runtime.restore()

    def test_wrong_statement_cannot_turn_executor_into_attestation_relay(self):
        for field, bad in [
            ("bootId", "attacker_boot"),
            ("releaseRecipientJwk", public(self.keys["device"])),
            ("certificateDigest", "e" * 64),
            ("authorizationMode", "account"),
        ]:
            self.authority.tamper = lambda r, field=field, bad=bad: {
                **r,
                "statement": {**r["statement"], field: bad},
            }
            with self.assertRaises(Stopped):
                self.new_runtime().restore()
        self.assertEqual(self.attestor.statements, [])

    def test_attestation_denial_does_not_restore_keyring(self):
        self.attestor.allowed = False
        with self.assertRaises(Stopped):
            self.runtime.restore()
        self.assertIsNone(self.runtime._keys)
        self.assertFalse(self.authority.confirmed)

    def test_current_lease_and_scope_are_required_for_every_new_operation(self):
        self.runtime.restore()
        op = self.operation()
        self.runtime.authorize(ACCESS, "execute", op, self.value["scope"]["resourceBindings"])
        calls = len(self.authority.calls)
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", op, [{"ref": {"kind": "holdings"}}])
        self.assertEqual(len(self.authority.calls), calls)
        self.authority.revoked = True
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", op, [])
        self.assertEqual(len(self.attestor.statements), 2)

    def test_revocation_after_lease_but_before_use_fails_fresh_checkpoint(self):
        self.runtime.restore()
        self.authority.after_lease = lambda: setattr(self.authority, "revoked", True)
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", self.operation(), [])

    def test_wrong_account_and_operation_binding_cannot_obtain_lease(self):
        self.runtime.restore()
        with self.assertRaises(Stopped):
            self.runtime.authorize("wrong_account", "execute", self.operation(), [])
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", self.operation(bindingDigest="f" * 64), [])

    def test_persisted_outbox_survives_new_process_and_backup_restore(self):
        self.runtime.restore()
        op = self.operation()
        raw = b'{"synthetic":"exact encrypted report bytes retained before submit"}'
        nxt = clone(self.state)
        nxt["sequence"] += 1
        nxt["outbox"][op["operationId"]] = {
            "operation": op,
            "bytes": b64url_encode(raw),
            "digest": hashlib.sha256(raw).hexdigest(),
        }
        result = self.runtime.persist(ACCESS, op, nxt, self.receipt(op))
        self.assertEqual(result["nextHead"], self.authority.head)
        self.assertNotEqual(self.head, self.authority.head)
        self.assertNotIn(
            raw, (self.snapshots.directory / (self.authority.head + ".json")).read_bytes()
        )
        restarted = self.new_runtime()
        restarted.restore()
        self.assertEqual(restarted.snapshot_state(ACCESS)["outbox"], nxt["outbox"])
        self.assertEqual(restarted.identity()["tlsJwk"], self.value["tlsJwk"])

    def test_unknown_commit_ack_stops_then_recovers_policy_selected_outbox(self):
        self.runtime.restore()
        self.authority.drop_commit_response = True
        nxt = clone(self.state)
        nxt["sequence"] += 1
        op = self.operation()
        with self.assertRaises(Stopped):
            self.runtime.persist(ACCESS, op, nxt, self.receipt(op))
        self.assertIsNone(self.runtime.head)
        self.authority.drop_commit_response = False
        second = self.new_runtime()
        second.restore()
        self.assertEqual(second.snapshot_state(ACCESS)["sequence"], 2)
        self.assertEqual(second.head, self.authority.commit_request["nextHead"])

    def test_real_new_process_recovers_original_public_keys_from_encrypted_snapshot(self):
        material = {
            "config": self.value,
            "policyKey": self.keys["policy"].export(private_key=True, as_dict=True),
            "dek": b64url_encode(self.dek),
            "head": self.head,
            "now": self.now,
            "snapshots": str(self.snapshots.directory),
        }
        backup = self.directory / "backup-restored-instance"
        shutil.copytree(self.snapshots.directory, backup)
        material["snapshots"] = str(backup)
        source = self.directory / "synthetic-authority.json"
        source.write_text(json.dumps(material))
        script = """
import json,sys,httpx
from pathlib import Path
from jwcrypto import jwk
from fixtures import Authority,Attestor
from app.config import Config
from app.policy import PolicyClient
from app.runtime import Executor
from app.state import FileSnapshots
from folioview_shared.encrypted.jsonutil import b64url_decode
p=json.loads(Path(sys.argv[1]).read_text());clock=lambda:p['now'];c=Config.parse(p['config'],now=p['now'])
a=Authority(c,jwk.JWK(**p['policyKey']),b64url_decode(p['dek']),p['head'],clock)
with httpx.Client(transport=httpx.MockTransport(a.handle)) as h:
 e=Executor(c,PolicyClient(c,client=h,clock=clock),Attestor(),FileSnapshots(p['snapshots']),clock=clock)
 print(json.dumps(e.restore()))
"""
        result = subprocess.run(
            [sys.executable, "-c", script, str(source)],
            capture_output=True,
            text=True,
            timeout=20,
            env={
                **os.environ,
                "PYTHONPATH": os.pathsep.join(
                    [
                        str(Path(__file__).parent),
                        str(Path(__file__).parents[1]),
                        str(Path(__file__).parents[3] / "common"),
                    ]
                ),
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout)["agentSigningJwk"], self.value["agentSigningJwk"]
        )
        self.assertEqual(
            json.loads(result.stdout)["agentEncryptionJwk"], self.value["agentEncryptionJwk"]
        )
        self.assertEqual(json.loads(result.stdout)["tlsJwk"], self.value["tlsJwk"])
        self.assertNotIn('"d":', result.stdout)
