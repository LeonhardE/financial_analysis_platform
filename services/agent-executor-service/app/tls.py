"""Original TLS identity, with public certificate replacement and RAM-only private material."""

import ctypes
import hashlib
import os
import ssl
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from jwcrypto import jwk

from folioview_shared.encrypted.crypto import jwk_thumbprint

from .contracts import Stopped, require, safe
from .state import public


def certificate(config, *, now):
    def validate():
        chain = config.public["certificateChain"].encode()
        certs = x509.load_pem_x509_certificates(chain)
        require(1 <= len(certs) <= 5)
        leaf = certs[0]
        key = jwk.JWK.from_pem(
            leaf.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        require(jwk_thumbprint(public(key)) == config.binding["tlsKeyId"])
        require(
            leaf.not_valid_before_utc <= datetime.fromtimestamp(now, UTC) < leaf.not_valid_after_utc
        )
        hostname = urlsplit(config.binding["audience"]).hostname
        names = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        require(hostname in names.get_values_for_type(x509.DNSName))
        require(not leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        return hashlib.sha256(chain).hexdigest()

    return safe(validate)


def _tmpfs(directory):
    # Linux statfs starts with the filesystem type; allocate ample aligned storage.
    result = (ctypes.c_long * 32)()
    library = ctypes.CDLL(None, use_errno=True)
    require(library.statfs(os.fsencode(directory), ctypes.byref(result)) == 0)
    require(result[0] == 0x01021994)  # TMPFS_MAGIC


@contextmanager
def materialize(config, key, *, now, directory="/dev/shm", require_tmpfs=True):
    certificate(config, now=now)
    if require_tmpfs:
        _tmpfs(directory)
    with tempfile.TemporaryDirectory(prefix="executor-tls-", dir=directory) as temporary:
        root = Path(temporary)
        os.chmod(root, 0o700)
        certfile, keyfile = root / "chain.pem", root / "key.pem"
        for path, body in [
            (certfile, config.public["certificateChain"].encode()),
            (keyfile, key.export_to_pem(private_key=True, password=None)),
        ]:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(body)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        try:
            context.load_cert_chain(certfile, keyfile)
        except Exception:
            raise Stopped from None
        yield context, str(certfile), str(keyfile)
