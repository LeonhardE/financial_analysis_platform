"""Owner public-artifact preparation; cloud writes are explicit subcommands only.

Run with the service root and common on PYTHONPATH. This tool is not in the TEE
image and never accepts, creates or exports an Executor or Root private key.
"""

import argparse
import hashlib
import ipaddress
import json
import os
import re
import shlex
import ssl
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.verification import PolicyBuilder, Store
from jwcrypto import jwk

from app.config import Config
from app.contracts import PROFILE, closed, digest, require
from app.native_config import NativeConfig
from app.state import public
from app.tls import certificate, subject_alt_name
from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

DRAFT_FIELDS = {
    "ownerSubject",
    "vaultId",
    "connectionId",
    "agentId",
    "clientId",
    "provider",
    "providerClientId",
    "identityEpoch",
    "issuer",
    "audience",
    "policyJwk",
    "recipientKeyIds",
    "scope",
    "workload",
    "creationWorkload",
    "kmsRecoveryKey",
    "snapshotBucket",
}
PENDING_FIELDS = {
    "profile",
    "enrollmentId",
    "draft",
    "permit",
    "agentSigningJwk",
    "agentEncryptionJwk",
    "tlsJwk",
    "certificateRequest",
    "creationAttestation",
}


def load(path, maximum=262144):
    return strict_json_loads(Path(path).read_bytes(), max_bytes=maximum)


def root_key(value, expected):
    validate_schema("PublicJWK", value)
    require(jwk_thumbprint(value) == expected)
    return value


def fresh_control(value, root, action, fields, now, *, fresh=True):
    payload = verify_jws(value, root, typ="fv-control+jws")
    closed(payload, {"profile", "action", "operationId", "issuedAt", "expiresAt", *fields})
    validate_schema("OperationIdentifier", payload["operationId"])
    require(payload["profile"] == PROFILE and payload["action"] == action)
    require(type(payload["issuedAt"]) is int and type(payload["expiresAt"]) is int)
    require(
        payload["issuedAt"] <= now
        and payload["issuedAt"] < payload["expiresAt"] <= payload["issuedAt"] + 300
    )
    require(not fresh or now < payload["expiresAt"])
    return payload


def csr(value, tls_jwk, hostname):
    validate_schema("PublicJWK", tls_jwk)
    require(type(value) is str and 1 <= len(value) <= 8192)
    request = x509.load_pem_x509_csr(value.encode())
    require(request.is_signature_valid)
    key = jwk.JWK.from_pem(
        request.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    require(jwk_thumbprint(public(key)) == jwk_thumbprint(tls_jwk))
    names = request.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    require(list(names) == [subject_alt_name(hostname)] and len(request.extensions) == 1)
    return request


def pending(offer, root, *, draft_digest, now, fresh=True):
    closed(offer, PENDING_FIELDS)
    require(offer["profile"] == PROFILE)
    draft = closed(offer["draft"], DRAFT_FIELDS)
    require(digest(draft) == draft_digest)
    permit = fresh_control(offer["permit"], root, "initialize", {"draftDigest"}, now, fresh=fresh)
    require(permit["draftDigest"] == draft_digest)
    expected_id = digest(
        {
            k: draft[k]
            for k in (
                "ownerSubject",
                "vaultId",
                "connectionId",
                "identityEpoch",
            )
        }
    )
    require(offer["enrollmentId"] == expected_id)
    ids = []
    for name in ["agentSigningJwk", "agentEncryptionJwk", "tlsJwk"]:
        validate_schema("PublicJWK", offer[name])
        ids.append(jwk_thumbprint(offer[name]))
    require(len(set(ids)) == 3 and jwk_thumbprint(root) not in ids)
    csr(offer["certificateRequest"], offer["tlsJwk"], urlsplit(draft["audience"]).hostname)
    evidence = closed(offer["creationAttestation"], {"statement", "token"}, maximum=32768)
    require(type(evidence["token"]) is str and len(evidence["token"].split(".")) == 3)
    require(
        evidence["statement"]
        == {
            "profile": PROFILE,
            "action": "offer",
            "issuer": draft["issuer"],
            "permitFingerprint": signing_input_fingerprint(offer["permit"]),
            "offerDigest": digest({k: v for k, v in offer.items() if k != "creationAttestation"}),
        }
    )
    # This local review cannot establish Google's signature or current VM state.
    # The independent verifier must reconstruct the statement from this object.
    return {
        "enrollmentId": expected_id,
        "offerDigest": digest(offer),
        "draftDigest": draft_digest,
        "originalKeyIds": ids,
        "hardwareProofVerified": False,
        "contentServiceEnabled": False,
    }


def validate_chain(chain, tls_jwk, hostname, *, now, trust_pem):
    require(type(chain) is str and 1 <= len(chain) <= 16384)
    certs = x509.load_pem_x509_certificates(chain.encode())
    require(1 <= len(certs) <= 5)
    key = jwk.JWK.from_pem(
        certs[0]
        .public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    require(jwk_thumbprint(public(key)) == jwk_thumbprint(tls_jwk))
    require(
        list(certs[0].extensions.get_extension_for_class(x509.SubjectAlternativeName).value)
        == [subject_alt_name(hostname)]
    )
    roots = x509.load_pem_x509_certificates(trust_pem)
    require(bool(roots))
    verifier = (
        PolicyBuilder()
        .store(Store(roots))
        .time(datetime.fromtimestamp(now, UTC))
        .build_server_verifier(subject_alt_name(hostname))
    )
    verifier.verify(certs[0], certs[1:])
    return {
        "certificateDigest": hashlib.sha256(chain.encode()).hexdigest(),
        "tlsKeyId": jwk_thumbprint(tls_jwk),
        "expiresAt": int(certs[0].not_valid_after_utc.timestamp()),
        "rootApprovalRequired": True,
    }


def bucket(project, suffix):
    require(bool(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project)))
    # Never allow emulator redirection to another authority.
    require(
        not any(os.getenv(k) for k in ["STORAGE_EMULATOR_HOST", "GOOGLE_API_USE_MTLS_ENDPOINT"])
    )
    from google.cloud import storage

    return storage.Client(project=project).bucket(project + suffix)


def upload(target, name, raw, generation, *, content_type="application/json"):
    require(type(generation) is int and generation >= 0)
    require(type(raw) is bytes and 1 <= len(raw) <= 262144)
    blob = target.blob(name)
    blob.cache_control = "no-store, max-age=0"
    blob.upload_from_string(
        raw,
        content_type=content_type,
        if_generation_match=generation,
        timeout=10,
        retry=None,
        checksum="crc32c",
    )
    require(bool(re.fullmatch(r"[1-9][0-9]{0,19}", str(blob.generation))))
    return str(blob.generation)


def challenge(environment, expected_host):
    require(environment.get("CERTBOT_IDENTIFIER") == expected_host)
    require(environment.get("CERTBOT_ALL_IDENTIFIERS") == expected_host)
    token = environment.get("CERTBOT_TOKEN", "")
    validation = environment.get("CERTBOT_VALIDATION", "")
    require(bool(re.fullmatch(r"[A-Za-z0-9_-]{22,128}", token)))
    require(bool(re.fullmatch(re.escape(token) + r"\.[A-Za-z0-9_-]{43}", validation)))
    return ".well-known/acme-challenge/" + token, validation.encode()


def certificate_command(request_path, tls_jwk, hostname, project, *, output, python=sys.executable):
    csr(Path(request_path).read_text(), tls_jwk, hostname)
    require(bool(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project)))
    hook = [python, str(Path(__file__).resolve())]
    common = ["--project", project, "--expected-host", hostname]
    # --csr selects the original public request. There is no private-key option,
    # installer, automatic lineage renewal, shell execution or CA call here.
    args = [
        "certbot",
        "certonly",
        "--csr",
        str(Path(request_path).resolve()),
        "--manual",
        "--preferred-challenges",
        "http",
        "--required-profile",
        "shortlived",
        "--manual-auth-hook",
        shlex.join(hook + ["acme-auth"] + common),
        "--manual-cleanup-hook",
        shlex.join(hook + ["acme-cleanup"] + common),
        "--cert-path",
        str(Path(output).resolve() / "leaf.pem"),
        "--chain-path",
        str(Path(output).resolve() / "chain.pem"),
        "--fullchain-path",
        str(Path(output).resolve() / "fullchain.pem"),
    ]
    try:
        ipaddress.ip_address(hostname)
        args += ["--ip-address", hostname]
    except ValueError:
        args += ["--domain", hostname]
    return args


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    review = sub.add_parser("review-pending")
    review.add_argument("--offer", required=True)
    review.add_argument("--draft-digest", required=True)
    final = sub.add_parser("publish-finalization")
    final.add_argument("--offer", required=True)
    final.add_argument("--draft-digest", required=True)
    final.add_argument("--control", required=True)
    publish = sub.add_parser("publish-config")
    publish.add_argument(
        "--kind", choices=["root", "draft", "permit", "core", "native"], required=True
    )
    publish.add_argument("--draft", required=True)
    publish.add_argument("--permit", required=True)
    publish.add_argument("--file", required=True)
    publish.add_argument("--core")
    publish.add_argument("--object", required=True)
    publish.add_argument("--expected-generation", type=int, required=True)
    for command in [review, final, publish]:
        command.add_argument("--root", required=True)
        command.add_argument("--root-key-id", required=True)
    final.add_argument("--project", required=True)
    publish.add_argument("--project", required=True)
    cert = sub.add_parser("certificate-command")
    cert.add_argument("--csr", required=True)
    cert.add_argument("--tls-jwk", required=True)
    cert.add_argument("--output", required=True)
    verify = sub.add_parser("verify-certificate")
    verify.add_argument("--chain", required=True)
    verify.add_argument("--tls-jwk", required=True)
    verify.add_argument("--trust-bundle", default=ssl.get_default_verify_paths().cafile)
    for name in ["acme-auth", "acme-cleanup"]:
        command = sub.add_parser(name)
        command.add_argument("--project", required=True)
        command.add_argument("--expected-host", required=True)
    for command in [cert, verify]:
        command.add_argument("--expected-host", required=True)
    cert.add_argument("--project", required=True)
    args = parser.parse_args()
    now = int(time.time())
    if args.action in {"acme-auth", "acme-cleanup"}:
        name, raw = challenge(os.environ, args.expected_host)
        target = bucket(args.project, "-executor-acme")
        if args.action == "acme-auth":
            print(upload(target, name, raw, 0, content_type="text/plain"))
        else:
            generation = os.environ.get("CERTBOT_AUTH_OUTPUT", "").strip()
            require(bool(re.fullmatch(r"[1-9][0-9]{0,19}", generation)))
            target.blob(name).delete(if_generation_match=int(generation), timeout=10, retry=None)
        return
    if args.action == "certificate-command":
        result = {
            "argv": certificate_command(
                args.csr, load(args.tls_jwk), args.expected_host, args.project, output=args.output
            ),
            "executed": False,
            "rootApprovalRequired": True,
        }
    elif args.action == "verify-certificate":
        result = validate_chain(
            Path(args.chain).read_text(),
            load(args.tls_jwk),
            args.expected_host,
            now=now,
            trust_pem=Path(args.trust_bundle).read_bytes(),
        )
    else:
        root = root_key(load(args.root), args.root_key_id)
        if args.action in {"review-pending", "publish-finalization"}:
            offer = load(args.offer, 65536)
            result = pending(
                offer,
                root,
                draft_digest=args.draft_digest,
                now=now,
                fresh=args.action != "publish-finalization",
            )
            if args.action == "publish-finalization":
                control = load(args.control)
                payload = fresh_control(
                    control,
                    root,
                    "finalize",
                    {"offerDigest", "bindingFingerprint", "workload"},
                    now,
                )
                require(payload["offerDigest"] == result["offerDigest"])
                original = offer["draft"]["workload"]
                require(
                    {**original, "environment": payload["workload"]["environment"]}
                    == payload["workload"]
                )
                validate_schema("Digest", payload["bindingFingerprint"])
                require(offer["draft"]["snapshotBucket"] == args.project + "-executor-state")
                name = "executor-enrollment/" + result["enrollmentId"] + "-finalization.json"
                result = {
                    "generation": upload(
                        bucket(args.project, "-executor-state"), name, canonical_json(control), 0
                    )
                }
        else:
            draft, permit = load(args.draft), load(args.permit)
            closed(draft, DRAFT_FIELDS)
            # Initial creation inputs require a fresh permit. Runtime updates are
            # instead verified by the complete Root-approved binding/registry.
            value = load(args.file)
            if args.kind in {"root", "draft", "permit"}:
                payload = fresh_control(permit, root, "initialize", {"draftDigest"}, now)
                require(payload["draftDigest"] == digest(draft))
                require(value == {"root": root, "draft": draft, "permit": permit}[args.kind])
            else:
                core = Config.parse(value if args.kind == "core" else load(args.core), now=now)
                root_key(core.public["rootJwk"], args.root_key_id)
                require(core.public["snapshotBucket"] == args.project + "-executor-state")
                certificate(core, now=now)
                if args.kind == "native":
                    NativeConfig.parse(value, core, now=now)
            require(draft["snapshotBucket"] == args.project + "-executor-state")
            require(
                bool(
                    re.fullmatch(
                        r"executor-config/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.json", args.object
                    )
                )
            )
            result = {
                "generation": upload(
                    bucket(args.project, "-executor-config"),
                    args.object,
                    canonical_json(value),
                    args.expected_generation,
                ),
                "sha256": digest(value),
            }
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Public artifact preparation stopped; review the pinned inputs.") from None
