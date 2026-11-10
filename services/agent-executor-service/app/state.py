"""Only authenticated ciphertext leaves the measured process; no local head authority."""

import os
import secrets
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jwcrypto import jwk

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.schema import validate_schema

from .contracts import (
    MAX_SNAPSHOT,
    PROFILE,
    Stopped,
    closed,
    digest,
    identity_digest,
    require,
    safe,
)


def public(key):
    value = key.export(private_key=False, as_dict=True)
    return {k: value[k] for k in ("kty", "crv", "x", "y")}


def validate_state(state, binding):
    return safe(lambda: _validate_state(state, binding))


def _validate_state(state, binding):
    closed(
        state,
        {"profile", "identityDigest", "sequence", "keys", "outbox", "receipts"},
        maximum=MAX_SNAPSHOT,
    )
    require(state["profile"] == PROFILE and state["identityDigest"] == identity_digest(binding))
    require(type(state["sequence"]) is int and 1 <= state["sequence"] <= 9007199254740991)
    closed(state["keys"], {"signing", "encryption", "tls"})
    keys = {}
    for name, field in {
        "signing": "agentSigningKeyId",
        "encryption": "agentEncryptionKeyId",
        "tls": "tlsKeyId",
    }.items():
        value = closed(state["keys"][name], {"kty", "crv", "x", "y", "d"})
        require(value["kty"] == "EC" and value["crv"] == "P-256")
        b64url_decode(value["d"], exact_bytes=32)
        key = jwk.JWK(**value)
        # cryptography validates the public/private point correspondence.
        key.export_to_pem(private_key=True, password=None)
        require(jwk_thumbprint(public(key)) == binding[field])
        keys[name] = key
    require(type(state["outbox"]) is dict and len(state["outbox"]) <= 16)
    for op, item in state["outbox"].items():
        validate_schema("OperationIdentifier", op)
        closed(item, {"operation", "bytes", "digest"}, maximum=786432)
        require(item["operation"]["operationId"] == op)
        from folioview_shared.encrypted.executor_trust import validate_executor_schema

        validate_executor_schema("ExecutorOperation", item["operation"])
        # Historical outbox/receipts survive a Root-approved code upgrade.
        # They are inert bytes; current operation authority is rechecked separately.
        raw = b64url_decode(item["bytes"], max_bytes=589824)
        require(__import__("hashlib").sha256(raw).hexdigest() == item["digest"])
    require(type(state["receipts"]) is list and len(state["receipts"]) <= 32)
    from folioview_shared.encrypted.executor_trust import validate_executor_schema

    for receipt in state["receipts"]:
        validate_executor_schema("ExecutorReceipt", receipt)
    return keys


def seal(state, key, binding):
    validate_state(state, binding)
    require(type(key) is bytes and len(key) == 32)
    aad = {"profile": PROFILE, "identityDigest": identity_digest(binding)}
    nonce = secrets.token_bytes(12)
    return {
        **aad,
        "nonce": b64url_encode(nonce),
        "ciphertext": b64url_encode(
            AESGCM(key).encrypt(nonce, canonical_json(state), canonical_json(aad))
        ),
    }


def unseal(packet, key, binding):
    def open_packet():
        closed(packet, {"profile", "identityDigest", "nonce", "ciphertext"}, maximum=MAX_SNAPSHOT)
        aad = {"profile": PROFILE, "identityDigest": identity_digest(binding)}
        require({k: packet[k] for k in aad} == aad)
        plaintext = AESGCM(key).decrypt(
            b64url_decode(packet["nonce"], exact_bytes=12),
            b64url_decode(packet["ciphertext"], max_bytes=MAX_SNAPSHOT),
            canonical_json(aad),
        )
        state = strict_json_loads(plaintext, max_bytes=MAX_SNAPSHOT)
        validate_state(state, binding)
        return state

    return safe(open_packet)


class FileSnapshots:
    """Local fixture backend, never selected by the production runtime."""

    def __init__(self, directory):
        self.directory = Path(directory)

    def read(self, head):
        def read():
            validate_schema("Digest", head)
            with (self.directory / (head + ".json")).open("rb") as f:
                raw = f.read(MAX_SNAPSHOT + 1)
            packet = strict_json_loads(raw, max_bytes=MAX_SNAPSHOT)
            require(digest(packet) == head)
            return packet

        return safe(read)

    def put(self, packet):
        raw = canonical_json(packet)
        require(len(raw) <= MAX_SNAPSHOT)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        head = digest(packet)
        fd, temporary = tempfile.mkstemp(dir=self.directory, prefix=".encrypted-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
                f.flush()
                os.fsync(f.fileno())
            try:
                os.link(temporary, self.directory / (head + ".json"))
            except FileExistsError:
                require(self.read(head) == packet)
            directory = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return head


class GCSSnapshots:
    def __init__(self, bucket, *, client=None):
        from google.cloud import storage

        self.bucket = (client or storage.Client()).bucket(bucket)

    def read(self, head):
        def read():
            validate_schema("Digest", head)
            blob = self.bucket.blob("executor-state/" + head + ".json")
            blob.reload(timeout=4, retry=None)
            require(type(blob.size) is int and 1 <= blob.size <= MAX_SNAPSHOT)
            packet = strict_json_loads(
                blob.download_as_bytes(
                    if_generation_match=blob.generation, timeout=4, retry=None, checksum="crc32c"
                ),
                max_bytes=MAX_SNAPSHOT,
            )
            require(digest(packet) == head)
            return packet

        return safe(read)

    def put(self, packet):
        from google.api_core.exceptions import PreconditionFailed

        raw = canonical_json(packet)
        require(len(raw) <= MAX_SNAPSHOT)
        head = digest(packet)
        try:
            self.bucket.blob("executor-state/" + head + ".json").upload_from_string(
                raw,
                content_type="application/json",
                if_generation_match=0,
                timeout=4,
                retry=None,
                checksum="crc32c",
            )
        except PreconditionFailed:
            require(self.read(head) == packet)
        except Exception:
            raise Stopped from None
        return head
