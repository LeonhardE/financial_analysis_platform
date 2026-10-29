"""Synthetic durable OAuth authority; no real owners, brokers or cloud calls."""

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fixtures import BOOT, OTHER_UID, UID, VaultFixture
from test_encrypted_envelope import EnvelopeFixture

from app.fences import FenceService
from app.oauth import OAuthFailure, OAuthService
from app.oauth_config import Client, OAuthConfig, digest
from app.store import SQLiteHubStore
from app.tasks import TaskService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode

ISSUER = "https://synthetic-hub.example"
CLIENT = "synthetic_muse"
CALLBACK = "https://synthetic-muse.example/callback"
COOKIE = "s" * 43
VERIFIER = "v" * 43
TASK = "synthetic_oauth_task"


class OAuthFixture(VaultFixture):
    context = EnvelopeFixture.context
    carrier = EnvelopeFixture.carrier

    def task_body(self, task=TASK, version=1, resources=()):
        context = self.context("task")
        context.update(
            objectId=task,
            revision=version,
            expectedRevision=version - 1,
            stableOperationId=f"synthetic_oauth_task_create_{version}",
            operationType="create_task" if version == 1 else "update_task",
            resourceBindings=copy.deepcopy(list(resources)),
        )
        context["binding"].update(taskId=task, taskVersion=version)
        value = {
            "contractVersion": CONTRACT_VERSION,
            "expectedVersion": version - 1,
            "resourceBindings": list(resources),
            "envelope": self.carrier(context),
        }
        if version == 1:
            value["taskId"] = task
        return value

    def pair(self, connection):
        self.add_key("A1_sig", "agent_sig", "synthetic_agent", connection)
        self.add_key("A1_enc", "agent_enc", "synthetic_agent", connection)
        self.bundle = self.make_bundle(previous=self.registry, issued_at=1000)
        self.registry = self.verify(self.bundle, previous=self.registry)

    def signed_grants(self, state, *, capabilities=None, **changes):
        values = []
        for task in state["prepared"]["tasks"]:
            bindings = [
                {
                    **copy.deepcopy(b),
                    "versionAccess": "future_within_source_epoch",
                    "selectedVersions": [],
                }
                for b in task["resourceBindings"]
            ]
            grant = self.grant(
                taskId=task["taskId"],
                taskVersions=[task["taskVersion"]],
                connectionId=state["connectionId"],
                authorizationId=state["authorizationId"],
                grantId=task["grantId"],
                grantEpoch=task["grantEpoch"],
                resourceBindings=bindings,
                executionEpoch=task["executionEpoch"],
                capabilities=capabilities or ["decrypt_task", "encrypt_result"],
            )
            grant.update(changes)
            values.append(self.sign(grant))
        return values


def configuration(secret=None):
    client = Client(
        CLIENT,
        [CALLBACK],
        "client_secret_basic" if secret else "none",
        digest(secret) if secret else None,
    )
    return OAuthConfig(ISSUER, ISSUER + "/oauth/consent", (client,))


def authorization_params(**changes):
    value = {
        "response_type": "code",
        "client_id": CLIENT,
        "redirect_uri": CALLBACK,
        "scope": "tasks:read results:create receipts:read",
        "resource": ISSUER + "/mcp/v2",
        "state": "synthetic_oauth_state_0001",
        "code_challenge_method": "S256",
        "code_challenge": b64url_encode(hashlib.sha256(VERIFIER.encode()).digest()),
    }
    return value | changes


def exchange_form(code):
    return {
        "grant_type": "authorization_code",
        "client_id": CLIENT,
        "redirect_uri": CALLBACK,
        "code": code,
        "code_verifier": VERIFIER,
        "resource": ISSUER + "/mcp/v2",
    }


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = SQLiteHubStore(Path(self.directory.name) / "hub.sqlite3")
        self.now = 1000
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.fixture = OAuthFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.tasks = TaskService(self.store, clock=lambda: self.now)
        self.create_task()
        self.service = OAuthService(self.store, configuration(), clock=lambda: self.now)

    def create_task(self, task=TASK, fixture=None, resources=()):
        fixture = fixture or self.fixture
        self.tasks.create(
            fixture.uid,
            fixture.task_body(task, resources=resources),
            "synthetic_oauth_task_create_1",
            fixture.kid("device_sig"),
        )

    def consent(
        self,
        *,
        uid=UID,
        fixture=None,
        task_ids=None,
        paired=True,
        connection_id=None,
        params=None,
        capabilities=None,
    ):
        fixture = fixture or self.fixture
        pending = self.service.authorize(params or authorization_params(), COOKIE)
        claimed = self.service.claim(uid, pending, COOKIE)
        if paired and connection_id is None:
            fixture.pair(claimed["connectionId"])
            self.vaults.update_registry(
                uid,
                fixture.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": fixture.registry.registry_sequence - 1,
                    "registryBundle": fixture.bundle,
                },
                f"synthetic_oauth_pair_registry_{fixture.registry.registry_sequence}",
            )
        prepared = self.service.prepare(uid, pending, COOKIE, task_ids or [TASK], connection_id)
        signed = fixture.signed_grants(prepared, capabilities=capabilities) if paired else []
        location = self.service.decide(uid, pending, COOKIE, "approve", signed)
        code = parse_qs(urlsplit(location).query)["code"][0]
        status, tokens, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual(status, 200, tokens)
        return tokens, prepared, code

    def assert_oauth(self, code, fn, status=None):
        with self.assertRaises(OAuthFailure) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)
        if status:
            self.assertEqual(caught.exception.status, status)

    def test_full_consent_code_rotation_and_restart_hash_only(self):
        tokens, prepared, code = self.consent()
        check = self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        self.assertEqual(check["taskIds"], [TASK])
        self.assertEqual(
            self.service.connections(UID)["items"][0]["grants"][0]["signedGrantPresent"], True
        )
        restarted = OAuthService(
            SQLiteHubStore(self.store.path), configuration(), clock=lambda: self.now
        )
        self.assertEqual(
            restarted.authenticate(tokens["access_token"])["connectionId"], prepared["connectionId"]
        )
        raw = Path(self.store.path).read_bytes()
        for secret in (tokens["access_token"], tokens["refresh_token"], code, COOKIE):
            self.assertNotIn(secret.encode(), raw)
        status, rotated, _ = restarted.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": tokens["refresh_token"],
                "resource": self.service.config.resource,
                "scope": "tasks:read",
            },
            {},
            "token",
        )
        self.assertEqual(status, 200, rotated)
        self.assertEqual(rotated["scope"], "tasks:read")
        self.assertNotEqual(rotated["refresh_token"], tokens["refresh_token"])
        status, body, _ = restarted.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": tokens["refresh_token"],
                "resource": self.service.config.resource,
            },
            {},
            "token",
        )
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))
        self.assert_oauth(
            "invalid_token", lambda: restarted.authenticate(rotated["access_token"]), 401
        )

    def test_oauth_consent_does_not_grant_keys_or_observe_agent_work(self):
        tokens, _, _ = self.consent(paired=False)
        self.service.authenticate(tokens["access_token"])
        self.assert_oauth(
            "insufficient_scope",
            lambda: self.service.authenticate(tokens["access_token"], TASK, "tasks:read"),
            403,
        )
        grant = self.service.connections(UID)["items"][0]["grants"][0]
        self.assertFalse(grant["signedGrantPresent"])
        self.assertFalse(grant["readObserved"])
        self.assertFalse(grant["resultSaved"])

    def test_invalid_code_client_pkce_audience_and_reuse(self):
        tokens, _, code = self.consent()
        status, body, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))
        self.assert_oauth(
            "invalid_token", lambda: self.service.authenticate(tokens["access_token"])
        )
        self.assert_oauth(
            "invalid_target",
            lambda: self.service.protocol(
                exchange_form("bad") | {"resource": ISSUER + "/mcp"}, {}, "token"
            ),
        )
        for changes in (
            {"code_verifier": "w" * 43},
            {"client_id": "wrong_client"},
            {"redirect_uri": CALLBACK + "/wrong"},
        ):
            status, value, _ = self.service.protocol(exchange_form(code) | changes, {}, "token")
            self.assertIn(status, (400, 401), value)

    def test_browser_owner_claim_binding_and_single_decision(self):
        pending = self.service.authorize(authorization_params(), COOKIE)
        with self.assertRaises(ContractError):
            self.service.claim(UID, pending, "x" * 43)
        self.service.claim(UID, pending, COOKIE)
        with self.assertRaises(ContractError):
            self.service.claim(OTHER_UID, pending, COOKIE)
        self.service.decide(UID, pending, COOKIE, "deny", [])
        with self.assertRaises(ContractError):
            self.service.decide(UID, pending, COOKIE, "approve", [])
        self.assertEqual(self.service.connections(UID)["items"], [])

    def test_task_edit_does_not_auto_authorize_new_rules(self):
        tokens, _, _ = self.consent()
        self.tasks.update(
            UID,
            TASK,
            self.fixture.task_body(version=2),
            "synthetic_oauth_task_create_2",
            self.fixture.kid("device_sig"),
        )
        with self.assertRaises(ContractError):
            self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        self.service.authenticate(tokens["access_token"])

    def test_owner_and_connection_revocation_isolation(self):
        first, one, _ = self.consent()
        second, two, _ = self.consent(paired=False)
        other = OAuthFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.create_task(fixture=other)
        third, _, _ = self.consent(uid=OTHER_UID, fixture=other, paired=False)
        with self.assertRaises(ContractError):
            self.service.revoke_connection(OTHER_UID, one["connectionId"])
        self.service.revoke_connection(UID, one["connectionId"])
        self.assert_oauth("invalid_token", lambda: self.service.authenticate(first["access_token"]))
        self.assertEqual(
            self.service.authenticate(second["access_token"])["connectionId"], two["connectionId"]
        )
        self.service.authenticate(third["access_token"])

    def test_reauthorization_does_not_revive_old_token_family(self):
        old, first, _ = self.consent()
        new, second, _ = self.consent(connection_id=first["connectionId"])
        self.assertEqual(first["connectionId"], second["connectionId"])
        self.assertNotEqual(first["authorizationId"], second["authorizationId"])
        self.assertEqual(second["prepared"]["tasks"][0]["grantEpoch"], 2)
        self.assert_oauth("invalid_token", lambda: self.service.authenticate(old["access_token"]))
        self.service.authenticate(new["access_token"], TASK, "tasks:read")
        status, body, _ = self.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": old["refresh_token"],
                "resource": self.service.config.resource,
            },
            {},
            "token",
        )
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))

    def test_pending_capacity_expiry_and_configuration_fail_closed(self):
        for _ in range(64):
            self.service.authorize(authorization_params(), COOKIE)
        self.assert_oauth(
            "temporarily_unavailable",
            lambda: self.service.authorize(authorization_params(), COOKIE),
            503,
        )
        self.now += 601
        self.service.authorize(authorization_params(), COOKIE)
        with self.assertRaises(ValueError):
            OAuthConfig(ISSUER, "https://other.example/consent", configuration().clients)
        for changes in (
            {"resource": ISSUER + "/mcp"},
            {"redirect_uri": CALLBACK + "/bad"},
            {"scope": "resources:read"},
            {"code_challenge_method": "plain"},
        ):
            self.assert_oauth(
                "invalid_request",
                lambda changes=changes: self.service.authorize(
                    authorization_params(**changes), COOKIE
                ),
            )


class FreshCatalogue:
    def __init__(self, resources):
        self.resources, self.available, self.calls = resources, True, 0

    def read(self, uid):
        self.calls += 1
        if not self.available:
            raise ContractError("source_unavailable")
        return {
            "groups": [
                {
                    "items": [
                        {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"], "state": "active"}
                        for b in self.resources
                    ]
                }
            ]
        }


class OAuthAuthorityTests(unittest.TestCase):
    setUp = OAuthTests.setUp
    create_task = OAuthTests.create_task
    consent = OAuthTests.consent
    assert_oauth = OAuthTests.assert_oauth

    def test_all_resource_kinds_scopes_and_live_source_fence(self):
        resources = [
            {
                "ref": {
                    "kind": kind,
                    "sourceService": "portfolio" if kind == "holdings" else "user",
                    "resourceId": "source_" + kind,
                    "incarnation": "synthetic_source_generation",
                },
                "sourceEpoch": 1,
            }
            for kind in ("holdings", "watchlist", "channel_follows")
        ]
        catalogue = FreshCatalogue(resources)
        self.tasks.catalogue = catalogue
        self.service.catalogue = catalogue
        task = "synthetic_resource_oauth_task"
        self.create_task(task, resources=resources)
        scopes = " ".join(
            sorted(
                {
                    "tasks:read",
                    "runs:create",
                    "results:create",
                    "portfolio:read",
                    "watchlist:read",
                    "channel_follows:read",
                }
            )
        )
        tokens, prepared, _ = self.consent(
            task_ids=[task], params=authorization_params(scope=scopes)
        )
        principal = self.store.transact(
            lambda unit: self.service.authorize_in_transaction(
                unit, tokens["access_token"], task, "tasks:read"
            )
        )
        self.assertEqual(principal.owner_uid, UID)
        self.assertEqual(len(principal.grant["resourceBindings"]), 3)
        self.assertEqual(catalogue.calls, 2)
        source = resources[0]
        FenceService(self.store, clock=lambda: self.now).invalidate(
            {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": self.fixture.owner,
                "mutationId": "synthetic_oauth_fence_change_0001",
                "ref": source["ref"],
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": "account_scope_changed",
            },
            source_service="portfolio",
        )
        with self.assertRaises(ContractError):
            self.service.authenticate(tokens["access_token"], task, "tasks:read")
        # OAuth remains valid; a source fence is not explicit token revocation.
        self.service.authenticate(tokens["access_token"])
        view = self.service.connections(UID)["items"][0]
        self.assertEqual(view["approvedScopes"], scopes.split())
        self.assertEqual(view["grants"][0]["resourceBindings"], resources)
        self.assertEqual(view["connectionId"], prepared["connectionId"])

    def test_guard_rechecks_revocation_in_same_mutation_transaction(self):
        tokens, prepared, _ = self.consent()
        self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        self.service.revoke_connection(UID, prepared["connectionId"])
        with self.assertRaises(OAuthFailure):
            self.store.transact(
                lambda unit: self.service.authorize_in_transaction(
                    unit, tokens["access_token"], TASK, "tasks:read"
                )
            )

    def test_one_task_grant_revocation_preserves_other_approved_task(self):
        second = "synthetic_second_oauth_task"
        self.create_task(second)
        tokens, prepared, _ = self.consent(task_ids=[TASK, second])
        self.service.revoke_grant(
            UID, prepared["connectionId"], prepared["prepared"]["tasks"][0]["grantId"]
        )
        self.assert_oauth(
            "insufficient_scope",
            lambda: self.service.authenticate(tokens["access_token"], TASK, "tasks:read"),
        )
        self.assertEqual(
            self.service.authenticate(tokens["access_token"], second, "tasks:read")["taskIds"],
            [second],
        )

    def test_expired_and_replaced_keys_stop_new_authority_without_changing_oauth(self):
        tokens, _, _ = self.consent()
        self.now = 1500
        with self.assertRaises(ContractError):
            self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        self.service.authenticate(tokens["access_token"])
        self.now = 1000
        old = self.fixture.registry
        bundle = self.fixture.make_bundle(
            previous=old, key_epoch=2, revoked=["A1_enc"], issued_at=1000
        )
        self.vaults.update_registry(
            UID,
            self.fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": old.registry_sequence,
                "registryBundle": bundle,
            },
            "synthetic_oauth_revoke_agent_key_0001",
        )
        with self.assertRaises(ContractError):
            self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        self.service.authenticate(tokens["access_token"])

    def test_attempt_denied_cancelled_expired_and_authorized_history(self):
        for decision in ("deny", "cancel"):
            pending = self.service.authorize(authorization_params(), COOKIE)
            self.service.claim(UID, pending, COOKIE)
            self.service.decide(UID, pending, COOKIE, decision, [])
        pending = self.service.authorize(authorization_params(), COOKIE)
        self.service.claim(UID, pending, COOKIE)
        self.now += 601
        attempts = self.service.connections(UID)["authorizationAttempts"]
        self.assertEqual({a["status"] for a in attempts}, {"denied", "cancelled", "expired"})
        raw = repr(attempts)
        for marker in (COOKIE, VERIFIER, "code_challenge", "browserHash", "state"):
            self.assertNotIn(marker, raw)

    def test_explicit_scope_narrowing_cannot_expand_on_refresh(self):
        pending = self.service.authorize(authorization_params(), COOKIE)
        self.service.claim(UID, pending, COOKIE)
        state = self.service.prepare(UID, pending, COOKIE, [TASK], approved_scopes=["tasks:read"])
        self.assertEqual(state["prepared"]["approvedScopes"], ["tasks:read"])
        location = self.service.decide(UID, pending, COOKIE, "approve", [])
        code = parse_qs(urlsplit(location).query)["code"][0]
        status, tokens, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual((status, tokens["scope"]), (200, "tasks:read"))
        status, value, _ = self.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "resource": self.service.config.resource,
                "refresh_token": tokens["refresh_token"],
                "scope": "tasks:read results:create",
            },
            {},
            "token",
        )
        self.assertEqual((status, value["error"]), (400, "invalid_scope"))

    def test_token_revocation_and_confidential_client_authentication(self):
        tokens, _, _ = self.consent()
        status, _, _ = self.service.protocol(
            {"client_id": CLIENT, "token": tokens["access_token"]}, {}, "revoke"
        )
        self.assertEqual(status, 200)
        self.assert_oauth(
            "invalid_token", lambda: self.service.authenticate(tokens["access_token"])
        )
        secret = "synthetic_confidential_secret_not_real"
        self.service.config = configuration(secret)
        pending = self.service.authorize(authorization_params(), COOKIE)
        self.service.claim(UID, pending, COOKIE)
        self.service.prepare(UID, pending, COOKIE, [TASK])
        location = self.service.decide(UID, pending, COOKIE, "approve", [])
        code = parse_qs(urlsplit(location).query)["code"][0]
        status, value, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual((status, value["error"]), (401, "invalid_client"))
        import base64

        form = exchange_form(code)
        del form["client_id"]
        basic = base64.b64encode((CLIENT + ":" + secret).encode()).decode()
        status, value, _ = self.service.protocol(form, {"Authorization": "Basic " + basic}, "token")
        self.assertEqual(status, 200, value)


class OAuthScopeFenceTests(unittest.TestCase):
    setUp = OAuthTests.setUp
    create_task = OAuthTests.create_task
    consent = OAuthTests.consent
    assert_oauth = OAuthTests.assert_oauth

    def test_zero_resource_run_needs_task_capability_but_not_resource_capability(self):
        tokens, _, _ = self.consent(
            params=authorization_params(scope="tasks:read runs:create results:create")
        )
        self.service.authenticate(tokens["access_token"], TASK, "runs:create")
        self.assert_oauth(
            "insufficient_scope",
            lambda: self.service.authenticate(tokens["access_token"], TASK, "portfolio:read"),
        )

    def test_narrowed_refresh_cannot_read_sources_via_run_scope(self):
        resource = {
            "ref": {
                "kind": "holdings",
                "sourceService": "portfolio",
                "resourceId": "source_holdings",
                "incarnation": "synthetic_source_generation",
            },
            "sourceEpoch": 1,
        }
        self.tasks.catalogue = self.service.catalogue = FreshCatalogue([resource])
        task = "synthetic_refresh_source_task"
        self.create_task(task, resources=[resource])
        params = authorization_params(scope="tasks:read runs:create results:create portfolio:read")
        tokens, _, _ = self.consent(
            task_ids=[task],
            params=params,
            capabilities=["decrypt_task", "decrypt_resources", "encrypt_result"],
        )
        self.service.authenticate(tokens["access_token"], task, "runs:create")
        status, narrowed, _ = self.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "resource": self.service.config.resource,
                "refresh_token": tokens["refresh_token"],
                "scope": "tasks:read runs:create",
            },
            {},
            "token",
        )
        self.assertEqual(status, 200, narrowed)
        self.assert_oauth(
            "insufficient_scope",
            lambda: self.service.authenticate(narrowed["access_token"], task, "runs:create"),
        )
        self.service.authenticate(narrowed["access_token"], task, "tasks:read")

    def test_read_scope_needs_signed_resource_decryption_capability(self):
        resource = {
            "ref": {
                "kind": "holdings",
                "sourceService": "portfolio",
                "resourceId": "source_holdings",
                "incarnation": "synthetic_source_generation",
            },
            "sourceEpoch": 1,
        }
        self.tasks.catalogue = self.service.catalogue = FreshCatalogue([resource])
        task = "synthetic_read_capability_task"
        self.create_task(task, resources=[resource])
        tokens, _, _ = self.consent(
            task_ids=[task],
            params=authorization_params(scope="tasks:read results:create portfolio:read"),
        )
        self.assert_oauth(
            "insufficient_scope",
            lambda: self.service.authenticate(tokens["access_token"], task, "portfolio:read"),
        )

    def test_live_source_failure_and_racing_invalidation_block_approval(self):
        resource = {
            "ref": {
                "kind": "holdings",
                "sourceService": "portfolio",
                "resourceId": "source_holdings",
                "incarnation": "synthetic_source_generation",
            },
            "sourceEpoch": 1,
        }
        catalogue = FreshCatalogue([resource])
        self.tasks.catalogue = self.service.catalogue = catalogue
        task = "synthetic_racing_source_task"
        self.create_task(task, resources=[resource])
        pending = self.service.authorize(
            authorization_params(scope="tasks:read results:create portfolio:read"), COOKIE
        )
        self.service.claim(UID, pending, COOKIE)
        self.service.prepare(UID, pending, COOKIE, [task])
        catalogue.available = False
        with self.assertRaises(ContractError):
            self.service.decide(UID, pending, COOKIE, "approve", [])
        self.assertEqual(self.service.connections(UID)["items"], [])
        catalogue.available = True
        original = catalogue.read

        def raced(uid):
            response = original(uid)
            FenceService(self.store, clock=lambda: self.now).invalidate(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "ownerSubject": self.fixture.owner,
                    "mutationId": "synthetic_oauth_racing_fence_0001",
                    "ref": resource["ref"],
                    "expectedSourceEpoch": 1,
                    "newSourceEpoch": 2,
                    "reason": "account_scope_changed",
                },
                source_service="portfolio",
            )
            return response

        catalogue.read = raced
        with self.assertRaises(ContractError):
            self.service.decide(UID, pending, COOKIE, "approve", [])
        self.assertEqual(self.service.connections(UID)["items"], [])


class OAuthProtocolSafetyTests(unittest.TestCase):
    setUp = OAuthTests.setUp
    create_task = OAuthTests.create_task
    consent = OAuthTests.consent
    assert_oauth = OAuthTests.assert_oauth

    def code(self):
        pending = self.service.authorize(authorization_params(), COOKIE)
        self.service.claim(UID, pending, COOKIE)
        self.service.prepare(UID, pending, COOKIE, [TASK])
        location = self.service.decide(UID, pending, COOKIE, "approve", [])
        return parse_qs(urlsplit(location).query)["code"][0]

    def test_bad_pkce_and_wrong_callback_do_not_consume_valid_code(self):
        code = self.code()
        for changes in ({"code_verifier": "w" * 43}, {"redirect_uri": CALLBACK + "/wrong"}):
            status, value, _ = self.service.protocol(exchange_form(code) | changes, {}, "token")
            self.assertEqual((status, value["error"]), (400, "invalid_grant"))
        status, value, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual(status, 200, value)

    def test_code_access_and_family_deadlines_are_absolute(self):
        code = self.code()
        self.now += 120
        status, value, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual((status, value["error"]), (400, "invalid_grant"))
        self.now = 1000
        tokens, _, _ = self.consent(paired=False)
        self.now = 1600
        self.assert_oauth(
            "invalid_token", lambda: self.service.authenticate(tokens["access_token"])
        )
        refresh = {
            "grant_type": "refresh_token",
            "client_id": CLIENT,
            "refresh_token": tokens["refresh_token"],
            "resource": self.service.config.resource,
        }
        status, renewed, _ = self.service.protocol(refresh, {}, "token")
        self.assertEqual(status, 200, renewed)
        self.now = 1000 + 30 * 86400
        refresh["refresh_token"] = renewed["refresh_token"]
        status, value, _ = self.service.protocol(refresh, {}, "token")
        self.assertEqual((status, value["error"]), (400, "invalid_grant"))

    def test_capacity_denial_preserves_existing_authority_and_revocation(self):
        from unittest.mock import patch

        with patch("app.oauth.MAX_CONNECTIONS", 1):
            tokens, prepared, _ = self.consent()
            with self.assertRaises(ContractError):
                self.consent(paired=False)
            self.service.authenticate(tokens["access_token"], TASK, "tasks:read")
        with patch("app.oauth.MAX_AUTHORIZATIONS", 1), self.assertRaises(ContractError):
            self.consent(connection_id=prepared["connectionId"])
        refresh = {
            "grant_type": "refresh_token",
            "client_id": CLIENT,
            "refresh_token": tokens["refresh_token"],
            "resource": self.service.config.resource,
        }
        with patch("app.oauth.MAX_ROTATIONS", 1):
            self.assert_oauth("invalid_grant", lambda: self.service.protocol(refresh, {}, "token"))
        self.service.revoke_connection(UID, prepared["connectionId"])
        self.assert_oauth(
            "invalid_token", lambda: self.service.authenticate(tokens["access_token"])
        )
