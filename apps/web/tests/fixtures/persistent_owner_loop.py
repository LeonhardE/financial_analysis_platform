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
from test_oauth import CLIENT, TASK, OAuthFixture

from app.agent_credentials import AgentCredentialService
from app.persistent_agents import PersistentAgentService
from app.persistent_results import PersistentOwnerResultService, PersistentResultService
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

    setup_state = credentials.owner_setup(UID, f.vault, sc.connection, setup["setupIntentId"])
    current = credentials.state(UID, f.vault, sc.connection)
    args = {"handoff": handoff, "setup": setup_state, "current": current, "hubOrigin": ORIGIN}
    packet = owner("credentialEnrollment", args)
    VaultService(sc.a.store, clock=lambda: 1000).update_registry(
        UID, f.vault, packet["registryUpdate"], "synthetic_browser_root_directory_001"
    )
    approved = credentials.command(
        UID, f.vault, sc.connection, packet["body"]["command"], packet["operationId"]
    )
    assert approved["identity"] == packet["identity"]
    dtos = [
        (
            f"/api/v3/agent-credentials/{f.vault}/{sc.connection}/setups/{setup['setupIntentId']}",
            "GET",
            setup_state,
            None,
        ),
        (
            f"/api/v3/agent-credentials/{f.vault}/{sc.connection}/approvals",
            "POST",
            approved,
            packet["operationId"],
        ),
        (
            f"/api/v3/agent-credentials/{f.vault}/{sc.connection}",
            "GET",
            credentials.state(UID, f.vault, sc.connection),
            None,
        ),
    ]
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
    assert call("initialize")["state"] == "connected"
    print("Web Owner approval activated private host credentials")
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
    from app.persistent_plans import PersistentOwnerPlanService, PersistentPlanService

    plans = PersistentPlanService(
        sc.a.store, cat, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: 1000
    )
    plan_receipt = call(
        "reportPlan",
        {"taskId": TASK, "status": "enabled", "planReference": "synthetic_web_native_plan"},
    )
    assert plan_receipt["state"] == "reported"
    plan = PersistentOwnerPlanService(sc.a.store, clock=lambda: 1000).state(
        UID, f.vault, sc.connection, TASK
    )
    plan_args = {
        "state": plan,
        "identityState": identity_state,
        "taskId": TASK,
        "hubOrigin": ORIGIN,
    }
    assert owner("plan", plan_args)["reported"]["reportedStatus"] == "enabled"
    forged = copy.deepcopy(plan_args)
    forged["state"]["reported"]["reportedStatus"] = "paused"
    owner("plan", forged, denied=True)
    forged = copy.deepcopy(plan_args)
    forged["hubOrigin"] = "https://agent-hub-api-999999999.northamerica-northeast2.run.app"
    owner("plan", forged, denied=True)
    dtos.append((f"/api/v2/persistent-plans/{f.vault}/{sc.connection}/{TASK}", "GET", plan, None))
    print("signed native plan statement verified independently by owner")
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
