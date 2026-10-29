"""Real Firestore SDK OAuth atomicity and conflict retries over synthetic RPCs."""

import json
import unittest
from urllib.parse import parse_qs, urlsplit

from fixtures import BOOT, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_oauth import (
    CLIENT,
    COOKIE,
    TASK,
    OAuthFixture,
    authorization_params,
    configuration,
    exchange_form,
)
from test_task_firestore import WriteConflictRpc

from app.oauth import OAuthFailure, OAuthService
from app.store import FirestoreHubStore
from app.tasks import TaskService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError


class FirestoreOAuthTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fixture = OAuthFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        TaskService(self.store, clock=lambda: 1000).create(
            UID,
            self.fixture.task_body(),
            "synthetic_oauth_task_create_1",
            self.fixture.kid("device_sig"),
        )
        self.service = OAuthService(self.store, configuration(), clock=lambda: 1000)
        self.rpc.calls.clear()

    def prepare(self):
        pending = self.service.authorize(authorization_params(), COOKIE)
        claimed = self.service.claim(UID, pending, COOKIE)
        self.fixture.pair(claimed["connectionId"])
        self.vaults.update_registry(
            UID,
            self.fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": self.fixture.bundle,
            },
            "synthetic_firestore_oauth_pair_0001",
        )
        prepared = self.service.prepare(UID, pending, COOKIE, [TASK])
        signed = self.fixture.signed_grants(prepared)
        return pending, signed

    def approve(self, pending, signed):
        location = self.service.decide(UID, pending, COOKIE, "approve", signed)
        return parse_qs(urlsplit(location).query)["code"][0]

    def tokens(self):
        pending, signed = self.prepare()
        code = self.approve(pending, signed)
        status, tokens, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual(status, 200, tokens)
        return tokens, code

    def batches(self):
        return [
            kwargs["request"]["writes"]
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def test_consent_and_code_exchange_have_atomic_persistent_hash_only_records(self):
        pending, signed = self.prepare()
        self.rpc.calls.clear()
        code = self.approve(pending, signed)
        self.assertEqual(len(self.batches()), 1)
        self.assertEqual(
            {
                write.update.name.split("/documents/")[1].split("/")[0]
                for write in self.batches()[0]
            },
            {
                "hub_oauth_codes",
                "hub_oauth_owners",
                "hub_oauth_connections",
                "hub_oauth_pending",
            },
        )
        self.rpc.calls.clear()
        status, tokens, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual(status, 200, tokens)
        self.assertEqual(len(self.batches()), 1)
        self.assertEqual(
            {
                write.update.name.split("/documents/")[1].split("/")[0]
                for write in self.batches()[0]
            },
            {
                "hub_oauth_access",
                "hub_oauth_refresh",
                "hub_oauth_families",
                "hub_oauth_codes",
            },
        )
        stored = json.dumps(self.rpc.documents)
        for value in (code, tokens["access_token"], tokens["refresh_token"], COOKIE):
            self.assertNotIn(value, stored)
        restarted = OAuthService(self.store, configuration(), clock=lambda: 1000)
        self.assertEqual(
            restarted.authenticate(tokens["access_token"], TASK, "tasks:read")["taskIds"], [TASK]
        )

    def test_code_exchange_conflict_retries_as_replay_and_commits_family_revocation(self):
        pending, signed = self.prepare()
        code = self.approve(pending, signed)
        winner = []
        self.inject(lambda: winner.append(self.service.protocol(exchange_form(code), {}, "token")))
        status, error, _ = self.service.protocol(exchange_form(code), {}, "token")
        self.assertEqual((status, error["error"]), (400, "invalid_grant"))
        self.assertEqual(winner[0][0], 200)
        with self.assertRaises(OAuthFailure) as denied:
            OAuthService(self.store, configuration(), clock=lambda: 1000).authenticate(
                winner[0][1]["access_token"]
            )
        self.assertEqual(denied.exception.code, "invalid_token")

    def test_refresh_conflict_rotates_once_and_replay_revocation_survives_retry(self):
        tokens, _ = self.tokens()
        form = {
            "grant_type": "refresh_token",
            "client_id": CLIENT,
            "resource": self.service.config.resource,
            "refresh_token": tokens["refresh_token"],
        }
        winner = []
        self.inject(lambda: winner.append(self.service.protocol(form, {}, "token")))
        status, body, _ = self.service.protocol(form, {}, "token")
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))
        self.assertEqual(winner[0][0], 200)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(winner[0][1]["access_token"])
        status, body, _ = self.service.protocol(
            {
                **form,
                "refresh_token": winner[0][1]["refresh_token"],
            },
            {},
            "token",
        )
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))

    def test_connection_revocation_wins_over_refresh_commit_and_no_new_tokens_are_saved(self):
        tokens, _ = self.tokens()
        connection = self.service.authenticate(tokens["access_token"])["connectionId"]
        before = set(self.rpc.documents)
        self.inject(lambda: self.service.revoke_connection(UID, connection))
        status, body, _ = self.service.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "resource": self.service.config.resource,
                "refresh_token": tokens["refresh_token"],
            },
            {},
            "token",
        )
        self.assertEqual((status, body["error"]), (400, "invalid_grant"))
        self.assertEqual(set(self.rpc.documents), before)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(tokens["access_token"])

    def test_agent_key_revocation_wins_approval_retry_and_no_code_is_committed(self):
        pending, signed = self.prepare()
        bundle = self.fixture.make_bundle(previous=self.fixture.registry, revoked=("A1_sig",))
        self.inject(
            lambda: self.vaults.update_registry(
                UID,
                self.fixture.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": 2,
                    "registryBundle": bundle,
                },
                "synthetic_firestore_oauth_revoke_0001",
            )
        )
        with self.assertRaises(ContractError):
            self.approve(pending, signed)
        self.assertFalse(any("/hub_oauth_codes/" in name for name in self.rpc.documents))
        self.assertEqual(self.service.connections(UID)["items"], [])
