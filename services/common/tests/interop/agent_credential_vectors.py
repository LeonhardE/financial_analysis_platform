"""Regenerate public Python-to-Node lease vectors from the repository root."""

import json
import sys
from pathlib import Path

sys.path[:0] = ["services/common", "services/common/tests"]
from jwcrypto import jwk  # noqa: E402
from test_agent_credentials import CredentialFixture  # noqa: E402

from folioview_shared.encrypted.crypto import jwk_thumbprint  # noqa: E402
from folioview_shared.encrypted.persistent_agents import initial_agent_identity  # noqa: E402

f = CredentialFixture()
a = f.f
# Deliberately public test scalar 1; never a real credential.
k = jwk.JWK.from_json(
    json.dumps(
        {
            "kty": "EC",
            "crv": "P-256",
            "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
            "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
            "d": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE",
        }
    )
)
a.keys["device_sig"] = k
c = a.certificates["device_sig"]
c["publicJwk"] = a.public(k)
c["keyId"] = jwk_thumbprint(c["publicJwk"])
a.bundle = a.make_bundle()
a.registry = a.verify(a.bundle)
f.legacy.expected["registry"] = a.registry
f.legacy.binding_payload.update(
    deviceSigningKeyId=a.kid("device_sig"), checkpointDigest=a.registry.checkpoint_digest
)
f.identity = f.legacy.identity = initial_agent_identity(f.legacy.verify_binding())
f.payload.update(
    deviceSigningKeyId=a.kid("device_sig"),
    checkpointDigest=a.registry.checkpoint_digest,
    bindingFingerprint=f.identity["bindingFingerprint"],
)
v = {
    "testOnly": True,
    "deviceTestScalar": "1",
    "anchor": {
        "root_jwk": a.root_public,
        "pinned_root_key_id": a.root_id,
        "owner_subject": a.owner,
        "vault_id": a.vault,
    },
    "registryBundle": a.bundle,
    "identity": f.identity,
    "identityBinding": a.sign(f.legacy.binding_payload),
    "pythonApproval": a.sign(f.payload),
    "setupIntentId": f.payload["setupIntentId"],
    "audience": f.payload["audience"],
}
Path("services/common/tests/fixtures/agent_credentials.json").write_text(
    json.dumps(v, indent=2) + "\n"
)
