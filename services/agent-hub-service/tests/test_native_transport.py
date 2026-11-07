"""Separate bootstrap-only OAuth; real Authlib, synthetic accounts and credentials."""

import copy
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from fixtures import BOOT, OTHER_UID, UID, VaultFixture
from test_oauth import CALLBACK, CLIENT, VERIFIER, authorization_params, configuration

from app.native_transport import PROFILE, REFRESH_IDLE_SECONDS, SCOPE, NativeTransportService
from app.oauth import OAuthFailure, OAuthService
from app.store import SQLiteHubStore, document_path
from app.vaults import VaultService
from folioview_shared.encrypted.errors import ContractError

BROWSER = "b" * 43


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.store = SQLiteHubStore(Path(scratch.name) / "native.sqlite3")
        self.now = 1000
        self.f = VaultFixture()
        VaultService(self.store, clock=lambda: self.now).bootstrap(UID, self.f.bootstrap(), BOOT)
        self.service = NativeTransportService(self.store, configuration(), clock=lambda: self.now)
        self.authorize_params = authorization_params(
            scope=SCOPE, resource=self.service.config.resource
        )

    def authorize(self, uid=UID):
        request = self.service.authorize(copy.deepcopy(self.authorize_params), BROWSER)
        callback = self.service.approve(uid, request, BROWSER, self.f.vault)
        fields = dict(parse_qsl(urlsplit(callback).query))
        return request, callback, fields["code"]

    def exchange(self, code):
        return self.service.protocol(
            {
                "grant_type": "authorization_code",
                "client_id": CLIENT,
                "code": code,
                "redirect_uri": CALLBACK,
                "code_verifier": VERIFIER,
                "resource": self.service.config.resource,
            },
            {},
            "token",
        )

    def connect(self):
        _, _, code = self.authorize()
        status, tokens, _ = self.exchange(code)
        self.assertEqual(status, 200)
        return tokens

    def refresh(self, token):
        return self.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": token,
                "resource": self.service.config.resource,
            },
            {},
            "token",
        )

    def test_metadata_and_actual_code_exchange_are_bootstrap_only(self):
        self.assertEqual(self.service.metadata()["scopes_supported"], [SCOPE])
        self.assertEqual(
            self.service.metadata()["issuer"], configuration().issuer + "/oauth/persistent"
        )
        tokens = self.connect()
        p = self.service.authenticate(tokens["access_token"])
        self.assertEqual(tokens["scope"], SCOPE)
        self.assertEqual(p.owner_subject, self.f.owner)
        self.assertEqual(p.vault_id, self.f.vault)
        self.assertEqual(tokens["expires_in"], 600)
        self.assertFalse(hasattr(self.service, "authorize_in_transaction"))

    def test_pending_is_cookie_and_google_owner_bound_and_creates_no_resource_authority(self):
        request = self.service.authorize(self.authorize_params, BROWSER)
        state = self.service.pending(UID, request, BROWSER)
        self.assertEqual(state["profile"], PROFILE)
        self.assertEqual(state["authority"], "account_link_only")
        callback = self.service.approve(UID, request, BROWSER, self.f.vault)
        self.assertEqual(self.service.approve(UID, request, BROWSER, self.f.vault), callback)
        with self.assertRaises(ContractError):
            self.service.approve(OTHER_UID, request, BROWSER, self.f.vault)
        with self.assertRaises(ContractError):
            self.service.pending(UID, request, "c" * 43)
        from urllib.parse import parse_qsl, urlsplit

        code = dict(parse_qsl(urlsplit(callback).query))["code"]
        status, tokens, _ = self.exchange(code)
        self.assertEqual(status, 200)
        principal = self.service.authenticate(tokens["access_token"])

        def stored(unit):
            parent = unit.get(
                document_path("hub_oauth_connections", self.f.owner, principal.connection_id)
            )
            identity = unit.get(
                document_path(
                    "hub_agent_identities", self.f.owner, self.f.vault, principal.connection_id
                )
            )
            consent = unit.get(
                document_path(
                    "hub_resource_consents", self.f.owner, self.f.vault, principal.connection_id
                )
            )
            return parent, identity, consent

        parent, identity, consent = self.store.transact(stored)
        self.assertEqual(parent["grants"], {})
        self.assertEqual(parent["approvedScopes"], [SCOPE])
        self.assertIsNone(identity)
        self.assertIsNone(consent)

    def test_financial_scope_and_v2_resource_are_rejected(self):
        for change in (
            {"scope": "portfolio:read"},
            {"scope": SCOPE + " tasks:read"},
            {"resource": configuration().resource},
        ):
            with self.assertRaises(OAuthFailure):
                self.service.authorize(self.authorize_params | change, BROWSER)

    def test_native_tokens_are_not_accepted_by_legacy_oauth(self):
        tokens = self.connect()
        legacy = OAuthService(self.store, configuration(), clock=lambda: self.now)
        with self.assertRaises(OAuthFailure):
            legacy.authenticate(tokens["access_token"])
        status, body, _ = legacy.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": tokens["refresh_token"],
                "resource": configuration().resource,
            },
            {},
            "token",
        )
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_grant")

    def test_refresh_survives_legacy_absolute_deadline_and_extends_only_idle_window(self):
        tokens = self.connect()
        p = self.service.authenticate(tokens["access_token"])
        self.now += 31 * 86400
        status, new, _ = self.refresh(tokens["refresh_token"])
        self.assertEqual(status, 200)
        self.assertNotEqual(new["refresh_token"], tokens["refresh_token"])
        self.assertEqual(
            self.service.authenticate(new["access_token"]).connection_id, p.connection_id
        )
        self.now += 170 * 86400
        status, newer, _ = self.refresh(new["refresh_token"])
        self.assertEqual(status, 200)
        self.assertEqual(
            self.service.authenticate(newer["access_token"]).connection_id, p.connection_id
        )

    def test_refresh_replay_revokes_family_but_not_root_parent(self):
        tokens = self.connect()
        old = self.service.authenticate(tokens["access_token"])
        status, new, _ = self.refresh(tokens["refresh_token"])
        self.assertEqual(status, 200)
        status, body, _ = self.refresh(tokens["refresh_token"])
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_grant")
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(new["access_token"])
        parent = self.store.transact(
            lambda u: u.get(document_path("hub_oauth_connections", self.f.owner, old.connection_id))
        )
        self.assertEqual(parent["status"], "active")
        repaired = self.connect()
        self.assertEqual(
            self.service.authenticate(repaired["access_token"]).connection_id, old.connection_id
        )

    def test_explicit_native_disconnect_terminally_stops_current_parent(self):
        tokens = self.connect()
        p = self.service.authenticate(tokens["access_token"])
        status, _, _ = self.service.protocol(
            {
                "client_id": CLIENT,
                "token": tokens["refresh_token"],
                "resource": self.service.config.resource,
            },
            {},
            "revoke",
        )
        self.assertEqual(status, 200)
        parent = self.store.transact(
            lambda u: u.get(document_path("hub_oauth_connections", self.f.owner, p.connection_id))
        )
        self.assertEqual(parent["status"], "revoked")
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(tokens["access_token"])

    def test_idle_expiration_requires_account_repair_without_creating_another_parent(self):
        tokens = self.connect()
        p = self.service.authenticate(tokens["access_token"])
        self.now += REFRESH_IDLE_SECONDS + 1
        status, _, _ = self.refresh(tokens["refresh_token"])
        self.assertEqual(status, 400)
        repaired = self.connect()
        self.assertEqual(
            self.service.authenticate(repaired["access_token"]).connection_id, p.connection_id
        )

    def test_old_family_disconnect_cannot_revoke_repaired_current_account(self):
        first = self.connect()
        p = self.service.authenticate(first["access_token"])
        second = self.connect()
        status, _, _ = self.service.protocol(
            {
                "client_id": CLIENT,
                "token": first["refresh_token"],
                "resource": self.service.config.resource,
            },
            {},
            "revoke",
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            self.service.authenticate(second["access_token"]).connection_id, p.connection_id
        )

    def test_bad_pkce_callback_and_client_cannot_exchange_original_code(self):
        _, _, code = self.authorize()
        valid = {
            "grant_type": "authorization_code",
            "client_id": CLIENT,
            "code": code,
            "redirect_uri": CALLBACK,
            "code_verifier": VERIFIER,
            "resource": self.service.config.resource,
        }
        for changes in (
            {"code_verifier": "x" * 43},
            {"redirect_uri": "https://other.example/callback"},
            {"client_id": "unknown_client"},
        ):
            status, _, _ = self.service.protocol(valid | changes, {}, "token")
            self.assertIn(status, (400, 401))
        self.assertEqual(self.exchange(code)[0], 200)

    def test_authorization_code_replay_stops_family_and_never_mints_a_fork(self):
        _, _, code = self.authorize()
        _, tokens, _ = self.exchange(code)
        self.assertEqual(self.exchange(code)[0], 400)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(tokens["access_token"])

    def test_client_cannot_use_access_as_refresh_or_expand_scope_while_rotating(self):
        tokens = self.connect()
        self.assertEqual(self.refresh(tokens["access_token"])[0], 400)
        with self.assertRaises(OAuthFailure):
            self.service.protocol(
                {
                    "grant_type": "refresh_token",
                    "client_id": CLIENT,
                    "refresh_token": tokens["refresh_token"],
                    "resource": self.service.config.resource,
                    "scope": "portfolio:read",
                },
                {},
                "token",
            )
        self.assertEqual(self.refresh(tokens["refresh_token"])[0], 200)

    def test_confidential_client_requires_registered_basic_secret_for_exchange(self):
        import base64

        value = "synthetic" + "_native_client_value"
        self.service = NativeTransportService(
            self.store, configuration(value), clock=lambda: self.now
        )
        _, _, code = self.authorize()
        self.assertEqual(self.exchange(code)[0], 401)
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": CALLBACK,
            "code_verifier": VERIFIER,
            "resource": self.service.config.resource,
        }
        headers = {
            "Authorization": "Basic " + base64.b64encode((CLIENT + ":" + value).encode()).decode()
        }
        status, tokens, _ = self.service.protocol(form, headers, "token")
        self.assertEqual(status, 200)
        self.assertEqual(self.service.authenticate(tokens["access_token"]).client_id, CLIENT)

    def test_database_callback_cache_contains_no_plain_code_or_callback_and_is_request_bound(self):
        request, callback, code = self.authorize()
        pending = self.store.transact(
            lambda u: u.get(document_path("hub_native_oauth_pending", "pool"))
        )
        from folioview_shared.encrypted.jsonutil import canonical_json

        raw = canonical_json(pending).decode()
        self.assertNotIn(code, raw)
        self.assertNotIn(callback, raw)
        self.assertEqual(self.service.approve(UID, request, BROWSER, self.f.vault), callback)

    def test_native_history_is_separate_from_legacy_connections_and_remains_readable_when_disabled(
        self,
    ):
        from app.native_transport import NativeConnectionOwnerService
        from app.oauth import OwnerConnectionService

        tokens = self.connect()
        principal = self.service.authenticate(tokens["access_token"])
        native = NativeConnectionOwnerService(self.store, clock=lambda: self.now)
        self.assertEqual(OwnerConnectionService(self.store).connections(UID)["items"], [])
        view = native.native_connections(UID)["connections"][0]
        self.assertEqual(view["connectionId"], principal.connection_id)
        self.assertEqual(view["accountState"], "connected")
        with self.assertRaises(ContractError):
            native.native_disconnect(OTHER_UID, principal.connection_id)
        self.assertEqual(
            native.native_disconnect(UID, principal.connection_id)["connection"]["status"],
            "revoked",
        )
        self.assertEqual(
            native.native_disconnect(UID, principal.connection_id)["connection"]["status"],
            "revoked",
        )
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(tokens["access_token"])

    def test_account_repair_preserves_actual_root_identity_and_resource_consent(self):
        from test_persistent_resource_store import Catalogue

        from app.persistent_agents import PersistentAgentService
        from app.resource_consents import ResourceConsentService
        from folioview_shared.encrypted.constants import CONTRACT_VERSION
        from folioview_shared.encrypted.persistent_agents import PERSISTENT_AGENT_PROFILE
        from folioview_shared.encrypted.persistent_content import BINDING_FIELDS
        from folioview_shared.encrypted.resource_consents import RESOURCE_CONSENT_PROFILE

        tokens = self.connect()
        principal = self.service.authenticate(tokens["access_token"])
        connection = principal.connection_id
        self.f.add_key("A1_sig", "agent_sig", "native_agent", connection)
        self.f.add_key("A1_enc", "agent_enc", "native_agent", connection)
        self.f.bundle = self.f.make_bundle(previous=self.f.registry, issued_at=1000)
        self.f.registry = self.f.verify(self.f.bundle, previous=self.f.registry)
        VaultService(self.store, clock=lambda: self.now).update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": self.f.bundle,
            },
            "synthetic_native_registry_01",
        )
        agents = PersistentAgentService(self.store, client_ids=[CLIENT], clock=lambda: self.now)
        operation = "synthetic_native_identity_bind_01"
        binding = {
            **self.f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.f.root_id,
            "connectionId": connection,
            "agentId": "native_agent",
            "clientId": CLIENT,
            "identityEpoch": 1,
            "agentSigningKeyId": self.f.kid("A1_sig"),
            "agentEncryptionKeyId": self.f.kid("A1_enc"),
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": operation,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": self.now,
        }
        identity = agents.command(UID, self.f.vault, connection, self.f.sign(binding), operation)[
            "identity"
        ]
        catalogue = Catalogue([self.f.resource])
        catalogue.revision = 1
        consents = ResourceConsentService(self.store, catalogue, clock=lambda: self.now)
        operation = "synthetic_native_consent_approval_01"
        approval = {
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            **{k: identity[k] for k in BINDING_FIELDS},
            "artifactType": "persistent_resource_approval",
            "consentId": "native_consent",
            "purpose": "analysis",
            "authorKeyId": self.f.root_id,
            "stableOperationId": operation,
            "expectedVersion": 0,
            "expectedConsentDigest": None,
            "issuedAt": self.now,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "resources": [
                {
                    "permissionId": "native_permission",
                    "ref": self.f.resource,
                    "sourceEpoch": 1,
                    "fromRevision": 1,
                    "versionPolicy": "current_and_future",
                    "selectedHistory": [],
                    "expectedPermissionEpoch": 0,
                }
            ],
        }
        policy = consents.command(
            UID, self.f.vault, connection, self.f.sign(approval, "root"), operation
        )["consent"]
        self.refresh(tokens["refresh_token"])
        self.refresh(tokens["refresh_token"])
        repaired = self.connect()
        self.assertEqual(
            self.service.authenticate(repaired["access_token"]).connection_id, connection
        )
        self.assertEqual(agents.state(UID, self.f.vault, connection)["identity"], identity)
        self.assertEqual(consents.state(UID, self.f.vault, connection)["consent"], policy)
