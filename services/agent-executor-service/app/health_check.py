"""Network-free crypto/contract self-test; never starts the content runtime."""

import json
import os


def probe():
    if os.environ.get("FOLIOVIEW_EXECUTION_MODE") != "offline_probe":
        raise RuntimeError("Offline probe only.")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from jwcrypto import jwk

    from folioview_shared.encrypted.crypto import sign_jws, verify_jws

    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    packet = AESGCM(key).encrypt(nonce, b"offline-self-test", b"executor-probe")
    if AESGCM(key).decrypt(nonce, packet, b"executor-probe") != b"offline-self-test":
        raise RuntimeError("Offline self-test failed.")
    signing = jwk.JWK.generate(kty="EC", crv="P-256")
    public = signing.export(private_key=False, as_dict=True)
    if verify_jws(
        sign_jws({"probe": True}, signing, typ="fv-control+jws"), public, typ="fv-control+jws"
    ) != {"probe": True}:
        raise RuntimeError("Offline self-test failed.")
    return {
        "profile": "confidential_vm_offline_probe.v1",
        "status": "ok",
        "contentServiceEnabled": False,
        "keyReleaseAttempted": False,
        "attestationVerified": False,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(probe(), separators=(",", ":")))
    except Exception:
        raise SystemExit("Offline self-test failed.") from None
