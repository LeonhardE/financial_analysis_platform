"""Actual independent Policy Root-control verifier; synthetic public inputs only."""

import json
import sys
from types import SimpleNamespace

sys.path[:0] = ["services/agent-policy-service", "services/common"]
from app.contracts import root_control
from folioview_shared.encrypted.errors import ContractError

value = json.loads(sys.stdin.buffer.read(131073))
config = SimpleNamespace(owner=value["owner"], root_jwk=value["rootJwk"])
options = {
    "action": value["action"],
    "connection": value["connection"],
    "version": value["version"],
    "head": value["head"],
    "parameters": value["parameters"],
    "now": value["now"],
}
root_control(value["command"], config, **options)
try:
    root_control(
        value["command"], config, **{**options, "parameters": {"changed": True}}
    )
except ContractError:
    print("ACTUAL POLICY VERIFIED ROOT CONTROL AND REJECTED CHANGED PARAMETERS")
else:
    raise AssertionError("Changed control parameters accepted")
