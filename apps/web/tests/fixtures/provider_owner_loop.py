"""Fresh synthetic owner/Agent keys and real producer transactions; no accounts or cloud calls."""

# ruff: noqa: E402
import copy
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path[:0] = [
    "services/agent-hub-service",
    "services/agent-hub-service/tests",
    "services/common",
    "services/common/tests",
]
import test_native_transport as accounts
from fixtures import UID
from test_oauth import CLIENT, OAuthFixture

from app.agent_credentials import AgentCredentialService
from app.persistent_results import PersistentResultService
from app.vaults import VaultService
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode

NODE = os.environ["FOLIOVIEW_NODE_BIN"]
OWNER_PEER = os.environ["FOLIOVIEW_OWNER_PEER"]
scratch = tempfile.TemporaryDirectory(prefix="folioview-owner-vectors-")
ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app"
p = subprocess.Popen(
    [NODE, "services/agent-hub-service/tests/private_host_peer.mjs"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
seq = 0
service = plans = None
fx = None
dropped = False
last_cipher = None
setup_case = None
methods = {
    "session": "session",
    "consent-receipts": "consent_receipt",
    "tasks": "tasks",
    "task-input": "task_input",
    "runs/begin": "begin",
    "runs/receipt": "run_receipt",
    "runs/input": "input",
    "runs/submit": "submit",
    "runs/result-receipt": "result_receipt",
    "plans/state": "plan_state",
    "plans/report": "report_plan",
}


def send(v):
    p.stdin.write(json.dumps(v) + "\n")
    p.stdin.flush()


def call(method, args=None, ok=True):
    global seq, dropped, last_cipher
    seq += 1
    send({"id": seq, "method": method, "args": args or {}, "origin": ORIGIN})
    while True:
        line = p.stdout.readline()
        if not line:
            raise RuntimeError(p.stderr.read()[:2000])
        result = json.loads(line)
        if "fetch" not in result:
            if ok and not result["ok"]:
                raise RuntimeError(result)
            return result.get("value") if ok else result
        response = {"response": result["fetch"]}
        try:
            path = result["path"]
            route = path.removeprefix(base + "/")
            target = plans if route.startswith("plans/") else service
            value = getattr(target, methods[route])(
                f.owner,
                f.vault,
                sc.connection,
                result["body"]["proof"],
                path,
                result["body"]["request"],
            )
            if route == "runs/submit":
                raw = json.dumps(result["body"]["request"]["envelope"], sort_keys=True)
                if last_cipher is not None:
                    assert last_cipher == raw
                last_cipher = raw
                if not dropped:
                    dropped = True
                    send({**response, "networkError": True})
                    continue
            response["value"] = value
        except ContractError as e:
            response.update(
                status=404
                if e.code == "not_found"
                else 403
                if e.code in ["key_authorization_required", "insufficient_scope"]
                else 409,
                value={"error": e.code},
            )
        send(response)


try:
    setup_case = accounts.NativeTransportTests()
    with patch("test_native_transport.VaultFixture", OAuthFixture):
        setup_case.setUp()
    tokens = setup_case.connect()
    principal = setup_case.service.authenticate(tokens["access_token"])
    f = setup_case.f
    fx = SimpleNamespace(now=1000, f=f)
    sc = SimpleNamespace(a=setup_case, f=f, connection=principal.connection_id)
    base = f"/agent/v3/persistent/owners/{f.owner}/vaults/{f.vault}/connections/{sc.connection}"
    service = PersistentResultService(
        sc.a.store, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: fx.now, catalogue=None
    )
    credentials = AgentCredentialService(
        sc.a.store, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: fx.now
    )
    setup = credentials.begin_setup(principal)
    actor = {
        "ownerSubject": f.owner,
        "vaultId": f.vault,
        "connectionId": sc.connection,
        "clientId": CLIENT,
    }
    prepared = call(
        "prepare",
        {
            "directory": scratch.name + "/agent-private",
            "bootstrap": {
                "issuer": ORIGIN,
                "provider": "muse",
                "actor": actor,
                "setup": setup,
                "ownerUrl": "https://owner.example/agents",
            },
        },
    )
    handoff = json.loads(
        b64url_decode(
            parse_qs(urlsplit(prepared["authorizationUrl"]).fragment)["agent_authorization"][0]
        )
    )
    credentials.put_offer(principal, setup["setupIntentId"], prepared["offer"])
    request = {
        "actor": {"connectionId": sc.connection, "clientId": CLIENT},
        "owner": f.owner,
        "rootPrivate": f.root.export(private_key=True, as_dict=True),
        "devicePrivate": f.keys["device_sig"].export(private_key=True, as_dict=True),
        "deviceKid": f.kid("device_sig"),
        "recoveryPrivate": f.keys["recovery_enc"].export(private_key=True, as_dict=True),
        "now": 1000,
    }
    fixture_file = Path(scratch.name) / "owner.json"
    fixture_file.touch(mode=0o600)

    def owner(operation, args, *, actor=None, denied=False):
        row = sc.a.store.transact(
            lambda u: u.get(
                __import__("app.store", fromlist=["document_path"]).document_path(
                    "hub_vaults", f.owner
                )
            )
        )
        previous_actor = request["actor"]
        if actor is not None:
            request["actor"] = actor
        request.update(
            op=operation,
            args=args,
            vault={
                k: row[k]
                for k in [
                    "vaultId",
                    "rootJwk",
                    "rootKeyId",
                    "registryHistory",
                    "archive",
                    "version",
                ]
            },
        )
        fixture_file.write_text(json.dumps(request))
        r = subprocess.run(
            [NODE, OWNER_PEER, str(fixture_file)], capture_output=True, text=True, timeout=20
        )
        request["actor"] = previous_actor
        if denied:
            assert r.returncode != 0, "Tampered owner operation unexpectedly accepted"
            return
        if r.returncode:
            raise RuntimeError(r.stderr)
        return json.loads(r.stdout)

    from app.provider_connections import ProviderConnectionService

    providers = ProviderConnectionService(
        sc.a.store, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: 1000
    )
    receipts = []
    for generation in [1, 2]:
        if generation == 2:
            setup = credentials.begin_setup(principal)
            prepared = call(
                "prepare",
                {
                    "directory": scratch.name + "/replacement-private",
                    "bootstrap": {
                        "issuer": ORIGIN,
                        "provider": "muse",
                        "actor": actor,
                        "setup": setup,
                        "ownerUrl": "https://owner.example/agents",
                    },
                },
            )
            handoff = json.loads(
                b64url_decode(
                    parse_qs(urlsplit(prepared["authorizationUrl"]).fragment)[
                        "agent_authorization"
                    ][0]
                )
            )
            credentials.put_offer(principal, setup["setupIntentId"], prepared["offer"])
        setup_state = credentials.owner_setup(UID, f.vault, sc.connection, setup["setupIntentId"])
        current = credentials.state(UID, f.vault, sc.connection)
        provider_state = providers.state(UID, f.vault, "muse")
        args = {
            "handoff": handoff,
            "setup": setup_state,
            "current": current,
            "hubOrigin": ORIGIN,
            "providerState": provider_state,
        }
        packet = owner("credentialEnrollment", args)
        assert packet["providerActivation"]["body"]["command"]["review"]["tasks"] == []
        assert packet["providerActivation"]["expectedGeneration"] == generation
        if packet.get("registryUpdate"):
            VaultService(sc.a.store, clock=lambda: 1000).update_registry(
                UID,
                f.vault,
                packet["registryUpdate"],
                "synthetic_provider_directory_000" + str(generation),
            )
        receipt = providers.command(
            UID,
            f.vault,
            "muse",
            packet["providerActivation"]["body"]["command"],
            packet["operationId"],
        )
        assert receipt["slot"]["slotGeneration"] == generation
        assert receipt["retainedSelections"] == [] and receipt["requiresFreshGrants"]
        recovered = providers.receipt(UID, f.vault, "muse", packet["operationId"])
        assert recovered == receipt
        owner("controlReceipt", {"packet": packet, "receipt": recovered})
        forged = copy.deepcopy(receipt)
        forged["slot"]["currentCredential"]["credentialFingerprint"] = "a" * 64
        owner("controlReceipt", {"packet": packet, "receipt": forged}, denied=True)
        assert (
            call(
                "activate",
                {
                    "setupIntentId": setup["setupIntentId"],
                    "state": "approved",
                    "activation": packet["body"]["command"]["activation"],
                },
            )["state"]
            == "connected"
        )
        receipts.append(receipt)
    assert receipts[0]["slot"]["currentCredential"] != receipts[1]["slot"]["currentCredential"]
    assert providers.state(UID, f.vault, "muse")["slot"] == receipts[1]["slot"]
    from folioview_shared.encrypted.provider_connections import require_current_provider_credential

    try:
        require_current_provider_credential(
            receipts[1]["slot"],
            receipts[0]["credentialReceipt"]["lease"],
            identity=receipts[0]["credentialReceipt"]["identity"],
            owner_subject=f.owner,
            vault_id=f.vault,
            provider="muse",
            audience=ORIGIN,
            now=1000,
        )
    except ContractError:
        pass
    else:
        raise AssertionError("Replaced credential remained current")
    print("PROVIDER OWNER ATOMIC LOOP COMPLETE")
finally:
    p.stdin.close()
    p.terminate()
    p.wait(timeout=5)
    if setup_case:
        setup_case.doCleanups()
    scratch.cleanup()
