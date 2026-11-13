"""Worker controls against real local signed Hub state, no cloud or account calls."""

# ruff: noqa: E402
import copy
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path[:0] = [
    "services/agent-hub-service",
    "services/agent-hub-service/tests",
    "services/common",
    "services/common/tests",
]
from fixtures import UID
from test_manual_intents import ManualIntentTests
from test_oauth import TASK

from app.store import document_path
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError

fx = ManualIntentTests()
fx.setUp()
try:
    f = fx.f
    with tempfile.TemporaryDirectory(prefix="fv-center-owner-") as temp:
        path = Path(temp) / "fixture.json"
        path.touch(mode=0o600)

        def owner(op, args, denied=False):
            row = fx.fx.store.transact(lambda u: u.get(document_path("hub_vaults", f.owner)))
            data = {
                "op": op,
                "args": args,
                "owner": f.owner,
                "now": fx.fx.fx.now,
                "actor": {"connectionId": fx.fx.connection, "clientId": fx.fx.identity["clientId"]},
                "rootPrivate": f.root.export(private_key=True, as_dict=True),
                "devicePrivate": f.keys["device_sig"].export(private_key=True, as_dict=True),
                "deviceKid": f.kid("device_sig"),
                "recoveryPrivate": f.keys["recovery_enc"].export(private_key=True, as_dict=True),
                "vault": {
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
            }
            path.write_text(json.dumps(data))
            r = subprocess.run(
                [os.environ["FOLIOVIEW_NODE_BIN"], os.environ["FOLIOVIEW_OWNER_PEER"], str(path)],
                capture_output=True,
                text=True,
                timeout=20,
            )
            if denied:
                assert r.returncode, "Forged Worker control unexpectedly accepted"
                return
            assert r.returncode == 0, r.stderr
            return json.loads(r.stdout)

        state = fx.owner.state(UID, f.vault, TASK)
        assert owner("taskCenterState", state)["taskId"] == TASK
        forged = copy.deepcopy(state)
        forged["assignments"][0]["assignment"]["authorityFingerprint"] = "a" * 64
        owner("taskCenterState", forged, True)
        packet = owner(
            "taskCenterControl",
            {
                "state": state,
                "action": "set_rules",
                "value": {
                    "frequency": "weekly",
                    "days": [1, 3, 5],
                    "localTime": "17:42",
                    "timeZone": "America/Toronto",
                },
            },
        )
        receipt = fx.owner.command(
            UID, f.vault, TASK, packet["body"]["command"], packet["operationId"]
        )
        owner("taskCenterReceipt", {"packet": packet, "receipt": receipt})
        state = fx.owner.state(UID, f.vault, TASK)
        # Rule changes leave old assignments inert; a manual request cannot reuse them.
        owner(
            "taskCenterControl",
            {
                "state": state,
                "action": "manual_intent",
                "value": [a["assignment"]["assignmentId"] for a in state["assignments"]],
            },
            True,
        )
        packet = owner("taskCenterControl", {"state": state, "action": "set_rules", "value": None})
        cancelled = fx.owner.cancel_operation(
            UID,
            f.vault,
            TASK,
            packet["operationId"],
            signing_input_fingerprint(packet["body"]["command"]),
        )
        owner("taskCenterReceipt", {"packet": packet, "receipt": cancelled})
        wrong = {**cancelled, "fingerprint": "a" * 64}
        owner("taskCenterReceipt", {"packet": packet, "receipt": wrong}, True)
        try:
            fx.owner.command(UID, f.vault, TASK, packet["body"]["command"], packet["operationId"])
        except ContractError:
            pass
        else:
            raise AssertionError("Cancelled request admitted")
        print("TASK CENTER WORKER LOOP COMPLETE")
finally:
    fx.doCleanups()
