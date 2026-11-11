"""Current leases fence real PoP APIs/final writes while Owner history remains readable."""

import unittest

import test_oauth as legacy
import test_owned_credentials as credentials
import test_persistent_results as results
from fixtures import UID
from test_persistent_identity_store import CONNECTION

from app.agent_credentials import AgentCredentialService
from app.native_transport import SCOPE
from app.oauth import OAuthFailure
from app.persistent_agents import identity_path
from app.resource_consents import consent_path, current_consent_path, stored_consent
from app.store import document_path
from folioview_shared.encrypted.agent_credentials import (
    AGENT_CREDENTIAL_PROFILE,
    approve_credential,
)
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import open_persistent_content

AUDIENCE = "https://synthetic-hub.example"


class CredentialExecutionFenceTests(unittest.TestCase):
    def setUp(self):
        self.result = results.PersistentResultTests()
        self.result.setUp()
        self.addCleanup(self.result.doCleanups)
        r = self.result
        self.helper = credentials.AgentCredentialTests()
        h = self.helper
        h.fx, h.f, h.store = r.fx, r.f, r.fx.store
        h.agent, h.signing, h.encryption = "synthetic_agent", "A1_sig", "A1_enc"
        h.serial = 0
        h.conn = {
            **r.fx.conn,
            "transportKind": "persistent_runtime",
            "approvedScopes": [SCOPE],
            "grants": {},
        }
        h.service = AgentCredentialService(
            h.store, audience=AUDIENCE, client_ids=[h.conn["clientId"]], clock=lambda: h.fx.now
        )
        # Seed the same legitimately Owner-signed generation-one state after the
        # existing fixture has prepared its real encrypted Run and content grants.
        # This is test setup, not a legacy-slot migration API.
        row = h.row()
        _, binding = _signed_parts(row["binding"])
        approval = {
            **binding,
            "artifactType": "agent_credential_approve",
            "profile": AGENT_CREDENTIAL_PROFILE,
            "bindingFingerprint": signing_input_fingerprint(row["binding"]),
            "generation": 1,
            "previousCredentialFingerprint": None,
            "setupIntentId": "synthetic_credential_fixture_setup_01",
            "audience": AUDIENCE,
            "issuedAt": h.fx.now,
            "expiresAt": h.fx.now + 100,
        }
        signed = h.f.sign(approval)
        lease = approve_credential(
            signed,
            registry=h.f.registry,
            identity=row["identity"],
            current_lease=None,
            setup_intent_id=approval["setupIntentId"],
            audience=AUDIENCE,
            now=h.fx.now,
        )
        self.original_consent = h.store.transact(
            lambda u: stored_consent(u, h.f.owner, h.f.vault, CONNECTION)
        )
        self.lease_row = {**row, "credentialLease": lease, "credentialApproval": signed}

        def seed(unit):
            unit.put(identity_path(h.f.owner, h.f.vault, CONNECTION), self.lease_row)
            unit.put(
                document_path("hub_oauth_connections", h.f.owner, CONNECTION),
                {**h.conn, "credentialMode": "agent_owned"},
            )
            unit.put(
                current_consent_path(unit, h.f.owner, h.f.vault, CONNECTION), self.original_consent
            )

        h.store.transact(seed)

    def test_expired_lease_denies_session_without_marking_owner_state(self):
        h = self.helper
        before = h.row()
        session = self.result.x.service.session(*self.result.x.args("session", {}))
        self.assertEqual(session["credentialLease"], before["credentialLease"])
        self.assertEqual(session["credentialApproval"], before["credentialApproval"])
        self.assertEqual(session["provider"], "muse")
        h.fx.now = before["credentialLease"]["expiresAt"]
        with self.assertRaises(ContractError):
            self.result.x.service.session(*self.result.x.args("session", {}))
        self.assertEqual(h.row(), before)

    def test_expiry_between_source_read_and_final_write_cannot_save_result(self):
        h = self.helper
        h.fx.catalogue.callback = lambda: setattr(
            h.fx, "now", self.lease_row["credentialLease"]["expiresAt"]
        )
        with self.assertRaises(ContractError):
            self.result.submit()
        self.assertEqual(self.result.history.owner_list(UID, h.f.vault)["items"], [])

    def test_rotation_between_source_read_and_final_write_fences_old_run(self):
        h = self.helper

        def rotate():
            h.fresh_keys()
            h.approve()

        h.fx.catalogue.callback = rotate
        with self.assertRaises(ContractError):
            self.result.submit()
        self.assertEqual(h.row()["credentialLease"]["generation"], 2)
        self.assertEqual(self.result.history.owner_list(UID, h.f.vault)["items"], [])

    def test_original_owner_report_and_consent_history_survive_reauthorization(self):
        h = self.helper
        receipt = self.result.submit()
        original = self.result.history.owner_get(UID, h.f.vault, receipt["resultId"])
        old_fingerprint = h.row()["identity"]["bindingFingerprint"]
        h.fresh_keys()
        h.approve()
        current = self.result.history.owner_get(UID, h.f.vault, receipt["resultId"])
        self.assertEqual(current["envelope"], original["envelope"])
        self.assertEqual(current["binding"], original["binding"])
        self.assertEqual(current["receipt"], receipt)
        for key in ("device_enc", "recovery_enc"):
            plain = open_persistent_content(
                current["envelope"]["jwe"], h.f.keys[key], context=self.result.context
            )
            self.assertEqual(plain["payload"]["title"], "Synthetic daily report")
        self.assertEqual(current["identity"]["bindingFingerprint"], old_fingerprint)
        self.assertIsNone(
            h.store.transact(lambda u: stored_consent(u, h.f.owner, h.f.vault, CONNECTION))
        )
        old = h.store.transact(
            lambda u: u.get(consent_path(h.f.owner, h.f.vault, CONNECTION, old_fingerprint))
        )
        self.assertEqual(old, self.original_consent)
        with self.assertRaises(ContractError):
            self.result.x.service.session(*self.result.x.args("session", {}))


class CredentialOAuthFenceTests(unittest.TestCase):
    def test_legacy_financial_bearer_and_refresh_cannot_bypass_owned_mode(self):
        f = legacy.OAuthTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        tokens, prepared, _ = f.consent()
        path = document_path("hub_oauth_connections", f.fixture.owner, prepared["connectionId"])
        f.store.transact(lambda u: u.put(path, {**u.get(path), "credentialMode": "agent_owned"}))
        with self.assertRaises(OAuthFailure):
            f.service.authenticate(tokens["access_token"])
        with self.assertRaises(OAuthFailure):
            f.store.transact(
                lambda u: f.service.authorize_in_transaction(
                    u, tokens["access_token"], legacy.TASK, "runs:create"
                )
            )
        status, _, _ = f.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": legacy.CLIENT,
                "refresh_token": tokens["refresh_token"],
                "resource": f.service.config.resource,
            },
            {},
            "token",
        )
        self.assertNotEqual(status, 200)

    def test_native_bootstrap_auto_refresh_retains_owned_mode(self):
        from test_native_transport import NativeTransportTests

        f = NativeTransportTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        tokens = f.connect()
        principal = f.service.authenticate(tokens["access_token"])
        path = document_path(
            "hub_oauth_connections", principal.owner_subject, principal.connection_id
        )
        f.store.transact(lambda u: u.put(path, {**u.get(path), "credentialMode": "agent_owned"}))
        self.assertEqual(
            f.service.authenticate(tokens["access_token"]).connection_id, principal.connection_id
        )
        status, refreshed, _ = f.refresh(tokens["refresh_token"])
        self.assertEqual(status, 200)
        self.assertEqual(
            f.service.authenticate(refreshed["access_token"]).connection_id, principal.connection_id
        )
        self.assertEqual(f.store.transact(lambda u: u.get(path))["credentialMode"], "agent_owned")


class CurrentEndpointIdentityTests(unittest.TestCase):
    def test_current_execution_rejects_a_valid_legacy_identity_without_an_owned_lease(self):
        import test_persistent_execution as executions

        from app.persistent_execution import PersistentExecutionService

        case = executions.PersistentExecutionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        args = case.args("session", {})
        self.assertIsNotNone(case.service.session(*args)["identity"])
        current = PersistentExecutionService(
            case.fx.store,
            case.fx.catalogue,
            audience=case.service.audience,
            client_ids=case.service.client_ids,
            clock=case.service.clock,
            managed_only=True,
        )
        with self.assertRaises(ContractError) as error:
            current.session(*args)
        self.assertEqual(error.exception.code, "key_authorization_required")
