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

sys.path[:0] = [
    "services/agent-hub-service",
    "services/agent-hub-service/tests",
    "services/common",
    "services/common/tests",
]
import test_runtime_setup as setups
from fixtures import UID
from jwcrypto import jwk
from test_oauth import CLIENT, TASK, OAuthFixture
from test_persistent_identity_store import CONNECTION

from app.persistent_results import PersistentOwnerResultService, PersistentResultService
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError

NODE = os.environ["FOLIOVIEW_NODE_BIN"]
OWNER_PEER = os.environ["FOLIOVIEW_OWNER_PEER"]
scratch = tempfile.TemporaryDirectory(prefix="folioview-owner-vectors-")
ORIGIN = "https://synthetic-hub.example"
p = subprocess.Popen(
    [NODE, "services/agent-hub-service/tests/runtime_session_peer.mjs"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
seq = 0
service = None
fx = None
dropped = False
last_cipher = None
setup_case = None
captured_offer = None
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
}


def send(v):
    p.stdin.write(json.dumps(v) + "\n")
    p.stdin.flush()


def call(method, args=None, ok=True):
    global seq, dropped, last_cipher, captured_offer
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
        path = result["path"]
        response = {"response": result["fetch"]}
        try:
            if path == "/agent/v3/runtime/config":
                value = {
                    "contractVersion": "folioview.agent-workspace.v2.0",
                    "runtimeVersion": "1.0.0",
                    "issuer": ORIGIN,
                    "serverNow": fx.now,
                }
            elif path.startswith("/agent/v3/runtime/setups/"):
                intent = path.split("/")[5]
                if path.endswith("/offers"):
                    captured_offer = result["body"]["proof"]
                    value = setup_case.service.offer(intent, captured_offer)
                else:
                    value = setup_case.service.public_state(intent)
            else:
                route = path.removeprefix(base + "/")
                body = result["body"]
                value = getattr(service, methods[route])(
                    fx.f.owner, fx.f.vault, CONNECTION, body["proof"], path, body["request"]
                )
                if route == "runs/submit":
                    raw = json.dumps(body["request"]["envelope"], sort_keys=True)
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
    setup_case = setups.RuntimeSetupTests()
    with patch("test_native_transport.VaultFixture", OAuthFixture):
        setup_case.setUp()
    sc = setup_case
    fx = SimpleNamespace(now=sc.a.now, f=sc.f)
    f = sc.f
    service = PersistentResultService(
        sc.a.store, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: fx.now, catalogue=None
    )
    base = f"/agent/v3/persistent/owners/{f.owner}/vaults/{f.vault}/connections/{sc.connection}"
    # The dispatcher uses the same fixture connection selector as the fixed actual request path.
    CONNECTION = sc.connection
    result = call("initialize", {"intentId": sc.intent, "rootKeyId": f.root_id})
    assert result["state"] == "awaiting_owner_approval"
    assert call("tasks", ok=False)["error"] == "runtime_not_connected"
    print("unapproved offer has no authority")
    _, payload = _signed_parts(captured_offer)
    sc.proof = captured_offer
    sc.payload = payload
    sc.agent = payload["agentId"]
    for name, field in [
        ("runtime_sig", "signingPublicJwk"),
        ("runtime_enc", "encryptionPublicJwk"),
    ]:
        key = jwk.JWK(**payload[field])
        f.keys[name] = key
        f.certificates[name].update(
            publicJwk=payload[field], keyId=key.thumbprint(), principalId=sc.agent
        )
    sc.service.confirm(
        sc.tokens["access_token"], sc.intent, sc.service.public_state(sc.intent)["offerFingerprint"]
    )
    row = sc.a.store.transact(
        lambda u: u.get(
            __import__("app.store", fromlist=["document_path"]).document_path("hub_vaults", f.owner)
        )
    )
    vault = {
        k: row[k]
        for k in ["vaultId", "rootJwk", "rootKeyId", "registryHistory", "archive", "version"]
    }
    request = {
        "actor": {"connectionId": sc.connection, "clientId": CLIENT},
        "op": "enrollment",
        "args": sc.service.owner_state(UID, sc.intent),
        "owner": f.owner,
        "vault": vault,
        "rootPrivate": f.root.export(private_key=True, as_dict=True),
        "devicePrivate": f.keys["device_sig"].export(private_key=True, as_dict=True),
        "deviceKid": f.kid("device_sig"),
        "recoveryPrivate": f.keys["recovery_enc"].export(private_key=True, as_dict=True),
        "now": 1000,
    }
    fixture_file = Path(scratch.name) / "owner.json"
    fixture_file.write_text(json.dumps(request))
    fixture_file.chmod(0o600)
    proc = subprocess.run(
        [NODE, OWNER_PEER, str(fixture_file)], text=True, capture_output=True, timeout=20
    )
    if proc.returncode:
        raise RuntimeError(proc.stderr)
    packet = json.loads(proc.stdout)
    dtos = [
        ("/api/v2/runtime-setups/" + sc.intent, "GET", sc.service.owner_state(UID, sc.intent), None)
    ]
    from app.persistent_agents import PersistentAgentService
    from app.vaults import VaultService

    VaultService(sc.a.store, clock=lambda: 1000).update_registry(
        UID, f.vault, packet["registryUpdate"], "synthetic_browser_root_directory_001"
    )
    identity = PersistentAgentService(sc.a.store, client_ids=[CLIENT], clock=lambda: 1000).command(
        UID, f.vault, sc.connection, packet["body"]["command"], packet["operationId"]
    )["identity"]
    assert identity == packet["identity"]
    dtos.append(
        (
            "/api/v2/runtime-setups/" + sc.intent + "/completion",
            "POST",
            sc.service.complete(UID, sc.intent),
            None,
        )
    )
    paired = call("pairing")
    assert paired["state"] == "connected"
    print("first Root pairing", paired["state"])
    resumed = call("initialize", {"intentId": sc.intent, "rootKeyId": f.root_id})
    assert resumed["state"] == "connected"
    print("partial-flow restart", resumed["state"])

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

    from test_encrypted_schema import report_content, resource_content, task_content
    from test_persistent_resource_store import Catalogue

    from app.persistent_publications import PersistentPublicationService
    from app.resource_consents import ResourceConsentService
    from app.tasks import TaskService

    cat = Catalogue([f.resource])
    cat.revision = 1
    policies = ResourceConsentService(sc.a.store, cat, client_ids=[CLIENT], clock=lambda: 1000)
    agents = PersistentAgentService(sc.a.store, client_ids=[CLIENT], clock=lambda: 1000)
    identity_state = agents.state(UID, f.vault, sc.connection)
    dtos.append(
        (f"/api/v2/persistent-agents/{f.vault}/{sc.connection}", "GET", identity_state, None)
    )
    policy_state = policies.state(UID, f.vault, sc.connection)
    packet = owner(
        "approve",
        {
            "identityState": identity_state,
            "resourceState": policy_state,
            "receipts": [],
            "resources": [{"ref": f.resource, "sourceEpoch": 1, "revision": 1, "state": "active"}],
        },
    )
    receipt = policies.command(
        UID, f.vault, sc.connection, packet["body"]["command"], packet["operationId"]
    )
    dtos.append(
        (
            f"/api/v2/persistent-agents/{f.vault}/{sc.connection}/resource-approvals",
            "POST",
            receipt,
            packet["operationId"],
        )
    )
    assert receipt["consent"] == packet["expected"]
    print("owner resource approval accepted")
    chain = [policies.receipt(UID, f.vault, sc.connection, packet["operationId"])]
    dtos.append(
        (
            f"/api/v2/persistent-agents/{f.vault}/{sc.connection}/resource-consent",
            "GET",
            policies.state(UID, f.vault, sc.connection),
            None,
        )
    )
    dtos.append(
        (
            f"/api/v2/persistent-agents/{f.vault}/{sc.connection}/resource-operations/{packet['operationId']}",
            "GET",
            chain[0],
            None,
        )
    )
    common = {
        "identityState": identity_state,
        "resourceState": policies.state(UID, f.vault, sc.connection),
        "receipts": chain,
    }
    publications_service = PersistentPublicationService(
        sc.a.store, cat, client_ids=[CLIENT], clock=lambda: 1000
    )
    content = resource_content("holdings", f.resource["resourceId"])
    content["fetchedAt"] = "1970-01-01T00:16:40Z"
    packet = owner(
        "resource",
        {
            **common,
            "ref": f.resource,
            "sourceEpoch": 1,
            "revision": 1,
            "objectId": f.resource["resourceId"],
            "ownerEnvelopeFingerprint": "a" * 64,
            "content": content,
        },
    )
    response = publications_service.publish(
        UID, f.vault, sc.connection, packet["body"]["envelope"], packet["operationId"]
    )
    dtos.append(
        (
            f"/api/v2/persistent-content/{f.vault}/connections/{sc.connection}/publications",
            "POST",
            response,
            packet["operationId"],
        )
    )
    assert response["fingerprint"] == packet["fingerprint"]
    print("owner resource ciphertext accepted")
    owner("publicationReceipt", {"packet": packet, "receipt": response})
    original = publications_service.receipt(UID, f.vault, sc.connection, packet["operationId"])
    dtos.append(
        (
            f"/api/v2/persistent-content/{f.vault}/connections/{sc.connection}/operations/{packet['operationId']}",
            "GET",
            original,
            None,
        )
    )
    retry = owner(
        "resource",
        {
            **common,
            "ref": f.resource,
            "sourceEpoch": 1,
            "revision": 1,
            "objectId": f.resource["resourceId"],
            "ownerEnvelopeFingerprint": "a" * 64,
            "content": content,
        },
    )
    assert (
        retry["operationId"] == packet["operationId"]
        and retry["fingerprint"] != packet["fingerprint"]
    )
    owner("publicationReceipt", {"packet": retry, "receipt": original})
    assert (
        owner(
            "approve",
            {
                **common,
                "resources": [
                    {"ref": f.resource, "sourceEpoch": 1, "revision": 1, "state": "active"}
                ],
            },
        )["kind"]
        == "no_change"
    )
    print("existing resource publication recovered without conflicting re-encryption")
    bad = copy.deepcopy(original)
    bad["envelope"]["jwe"]["ciphertext"] = (
        "A" if bad["envelope"]["jwe"]["ciphertext"][0] != "A" else "B"
    ) + bad["envelope"]["jwe"]["ciphertext"][1:]
    owner("publicationReceipt", {"packet": retry, "receipt": bad}, denied=True)
    bad = copy.deepcopy(original)
    bad["context"]["ownerEnvelopeFingerprint"] = "b" * 64
    owner("publicationReceipt", {"packet": retry, "receipt": bad}, denied=True)
    owner(
        "identity",
        identity_state,
        actor={"connectionId": "different_connection", "clientId": CLIENT},
        denied=True,
    )
    other_ref = {**f.resource, "resourceId": "different_resource"}
    owner(
        "resource",
        {
            **common,
            "ref": other_ref,
            "sourceEpoch": 1,
            "revision": 1,
            "objectId": other_ref["resourceId"],
            "ownerEnvelopeFingerprint": "a" * 64,
            "content": content,
        },
        denied=True,
    )

    f.bundle = request["vault"]["registryHistory"][-1]
    f.registry = f.verify(f.bundle, previous=f.registry)
    f.certificates["A1_sig"] = f.certificates["runtime_sig"]
    f.certificates["A1_enc"] = f.certificates["runtime_enc"]
    f.keys["A1_sig"] = f.keys["runtime_sig"]
    f.keys["A1_enc"] = f.keys["runtime_enc"]
    tasks_service = TaskService(sc.a.store, cat, clock=lambda: 1000)
    private_task = task_content()
    private_task["inputPolicy"]["allowUnknownAsOf"] = True
    with patch("test_encrypted_schema.task_content", lambda: private_task):
        task_body = f.task_body(resources=[{"ref": f.resource, "sourceEpoch": 1}])
    tasks_service.create(UID, task_body, "synthetic_oauth_task_create_1", f.kid("device_sig"))
    task = tasks_service.get(UID, TASK)
    packet = owner(
        "task",
        {
            **common,
            "authority": publications_service.task_state(UID, f.vault, TASK),
            "metadata": task["metadata"],
            "content": private_task,
            "resultPolicy": "owner_inbox",
            "allowReassign": False,
        },
    )
    response = publications_service.publish(
        UID, f.vault, sc.connection, packet["body"]["envelope"], packet["operationId"]
    )
    assert response["fingerprint"] == packet["fingerprint"]
    dtos.append(
        (
            f"/api/v2/persistent-content/{f.vault}/tasks/{TASK}/authority",
            "GET",
            publications_service.task_state(UID, f.vault, TASK),
            None,
        )
    )
    print("owner task authority accepted")
    service = PersistentResultService(
        sc.a.store, cat, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: 1000
    )
    print("restored tasks", len(call("tasks")))
    run = call("begin", {"taskId": TASK, "triggerId": "synthetic_owner_web_basic_001"})
    opened = call(
        "input", {"runId": run["runId"], "publicationId": run["inputs"][0]["publicationId"]}
    )
    assert opened["resource"] == content
    # Existing test dispatcher deliberately drops the first committed result response.
    saved = call("submit", {"runId": run["runId"], "report": report_content()}, ok=False)
    assert saved["error"] == "runtime_network_unavailable"
    saved = call("submit", {"runId": run["runId"], "report": report_content()})
    print("encrypted report", saved["state"])
    record = PersistentOwnerResultService(sc.a.store, clock=lambda: 1000).owner_get(
        UID, f.vault, saved["resultId"]
    )
    history = PersistentOwnerResultService(sc.a.store, clock=lambda: 1000)
    dtos.append(
        (f"/api/v2/persistent-results/{f.vault}", "GET", history.owner_list(UID, f.vault), None)
    )
    dtos.append((f"/api/v2/persistent-results/{f.vault}/{saved['resultId']}", "GET", record, None))
    opened = owner("result", {"record": record, "resultId": saved["resultId"]})
    assert opened == report_content()
    print("owner historical report decrypted")
    owner("result", {"record": record, "resultId": "different_result"}, denied=True)
    bad = copy.deepcopy(record)
    value = bad["envelope"]["jwe"]["ciphertext"]
    bad["envelope"]["jwe"]["ciphertext"] = ("A" if value[0] != "A" else "B") + value[1:]
    owner("result", {"record": bad, "resultId": saved["resultId"]}, denied=True)
    cat.revision = 4
    updated = owner(
        "resource",
        {
            **common,
            "ref": f.resource,
            "sourceEpoch": 1,
            "revision": 4,
            "objectId": f.resource["resourceId"],
            "ownerEnvelopeFingerprint": "b" * 64,
            "content": content,
        },
    )
    publications_service.publish(
        UID, f.vault, sc.connection, updated["body"]["envelope"], updated["operationId"]
    )
    newer = call("begin", {"taskId": TASK, "triggerId": "synthetic_owner_web_basic_002"})
    assert newer["inputs"][0]["sourceRevision"] == 4
    assert policies.state(UID, f.vault, sc.connection)["consent"]["version"] == 1
    permission = common["resourceState"]["consent"]["permissions"][0]["permissionId"]
    withdrawal = owner("revoke", {**common, "permissionIds": [permission]})
    policies.command(
        UID,
        f.vault,
        sc.connection,
        withdrawal["body"]["command"],
        withdrawal["operationId"],
        revoke=True,
    )
    assert (
        call("begin", {"taskId": TASK, "triggerId": "synthetic_owner_web_basic_003"}, ok=False)[
            "error"
        ]
        == "insufficient_scope"
    )
    assert owner("result", {"record": record, "resultId": saved["resultId"]}) == report_content()
    print(
        "version advancement kept permission; withdrawal blocked new Runs; owner history retained"
    )

    if os.getenv("FOLIOVIEW_TEST_DTO_FILE"):
        output = Path(os.environ["FOLIOVIEW_TEST_DTO_FILE"])
        output.write_text(json.dumps(dtos))
        output.chmod(0o600)
    print("OWNER AND AGENT FULL SYNTHETIC LOOP COMPLETE")

finally:
    p.stdin.close()
    p.terminate()
    p.wait(timeout=5)
    if setup_case:
        setup_case.doCleanups()
    scratch.cleanup()
