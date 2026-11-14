"""Real local Hub and Web crypto, synthetic keys over pipes only; no cloud."""

# ruff: noqa: E402
import copy
import json
import os
import subprocess
import sys

sys.path[:0] = ["services/agent-hub-service", "services/agent-hub-service/tests", "services/common"]
from fixtures import SOURCE, UID
from test_private_display_name_store import DisplayNameStoreTests

from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.private_display_names import decrypt_display_name

fx = DisplayNameStoreTests()
fx.setUp()
try:

    def owner(op, args, denied=False, **changes):
        payload = {
            "owner": fx.f.owner,
            "now": fx.now,
            "vault": fx.vaults.current(UID)["vault"],
            "device": fx.f.keys["device_sig"].export(private_key=True, as_dict=True),
            "deviceId": fx.f.kid("device_sig"),
            "reader": fx.f.keys["recovery_enc"].export(private_key=True, as_dict=True),
            "recoveryPublic": fx.f.public(fx.f.keys["recovery_enc"]),
            "op": op,
            "args": args,
            **changes,
        }
        value = subprocess.run(
            [os.environ["FOLIOVIEW_NODE_BIN"], os.environ["FOLIOVIEW_OWNER_PEER"]],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=20,
        )
        if denied:
            assert value.returncode != 0, "Worker accepted a forged name"
            return None
        assert value.returncode == 0, "Owner name operation failed: " + value.stderr
        return json.loads(value.stdout)

    one = fx.write(fx.packet(name="Python synthetic"))["item"]
    assert owner("read", {"ref": fx.ref, "item": one})["name"] == "Python synthetic"
    packet = owner("prepare", {"ref": fx.ref, "item": one, "name": "Web synthetic 名称"})
    two = fx.service.write(
        UID, fx.f.vault, SOURCE, packet["body"]["command"], packet["operationId"]
    )
    _, command = _signed_parts(two["item"]["command"])
    assert (
        decrypt_display_name(command["envelope"], fx.f.keys["recovery_enc"], context=command)
        == "Web synthetic 名称"
    )
    assert owner("receipt", {"packet": packet, "receipt": two})["name"] == "Web synthetic 名称"
    assert (
        owner("readMany", {"refs": [fx.ref], "items": [two["item"]]})[0]["state"]["revision"] == 2
    )
    three = fx.write(fx.packet(state=two["item"]["state"], name="Current synthetic"))
    assert (
        fx.service.write(UID, fx.f.vault, SOURCE, packet["body"]["command"], packet["operationId"])
        == two
    )
    assert fx.service.read(UID, fx.f.vault, SOURCE) == three
    owner("read", {"ref": fx.ref, "item": three["item"]}, denied=True, owner="other_owner")
    forged = copy.deepcopy(three["item"])
    forged["state"]["operationFingerprint"] = "a" * 64
    owner("read", {"ref": fx.ref, "item": forged}, denied=True)
    fx.now = 6000
    assert owner("read", {"ref": fx.ref, "item": three["item"]})["name"] == "Current synthetic"
    owner("prepare", {"ref": fx.ref, "item": three["item"], "name": "Expired writer"}, denied=True)
    print("DISPLAY NAMES LOCAL LOOP COMPLETE")
finally:
    fx.doCleanups()
