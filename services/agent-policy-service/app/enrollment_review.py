"""Fixed-purpose, Owner-authenticated review of original public enrollment evidence."""

import hashlib
from datetime import UTC, datetime
from urllib.parse import urlsplit

import certifi
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.verification import PolicyBuilder, Store
from jwcrypto import jwk

from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.executor_trust import validate_executor_schema
from folioview_shared.encrypted.jsonutil import b64url_decode
from folioview_shared.encrypted.schema import validate_schema

from .attestation import validate_workload
from .contracts import closed, deny, digest, number, scope

EXECUTOR = "folioview.agent-executor.v1"
REVIEW = "folioview.executor-enrollment-review.v1"
DRAFT = {
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
PENDING = {
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
FINAL = {
    "profile",
    "binding",
    "workload",
    "agentSigningJwk",
    "agentEncryptionJwk",
    "tlsJwk",
    "certificateRequest",
    "initialStateHead",
    "wrappedStateKey",
    "permit",
    "offerDigest",
    "finalization",
    "creationAttestation",
}


def control(value, root, action, fields, now, *, fresh):
    p = verify_jws(value, root, typ="fv-control+jws")
    closed(p, {"profile", "action", "operationId", "issuedAt", "expiresAt", *fields})
    validate_schema("OperationIdentifier", p["operationId"])
    number(p["issuedAt"])
    number(p["expiresAt"])
    if (
        p["profile"] != EXECUTOR
        or p["action"] != action
        or not p["issuedAt"] < p["expiresAt"] <= p["issuedAt"] + 300
        or p["issuedAt"] > now
        or (fresh and now >= p["expiresAt"])
    ):
        deny()
    return p


def original_keys(offer, audience):
    ids = []
    for name in ["agentSigningJwk", "agentEncryptionJwk", "tlsJwk"]:
        validate_schema("PublicJWK", offer[name])
        ids.append(jwk_thumbprint(offer[name]))
    if len(set(ids)) != 3:
        deny()
    raw = offer["certificateRequest"]
    if type(raw) is not str or not 1 <= len(raw) <= 8192:
        deny()
    request = x509.load_pem_x509_csr(raw.encode())
    key = jwk.JWK.from_pem(
        request.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    )
    pub = key.export(private_key=False, as_dict=True)
    public = {k: pub[k] for k in ("kty", "crv", "x", "y")}
    import ipaddress

    hostname = urlsplit(audience).hostname
    try:
        expected = x509.IPAddress(ipaddress.ip_address(hostname))
    except ValueError:
        expected = x509.DNSName(hostname)
    if (
        not request.is_signature_valid
        or jwk_thumbprint(public) != ids[2]
        or len(request.extensions) != 1
        or list(request.extensions.get_extension_for_class(x509.SubjectAlternativeName).value)
        != [expected]
    ):
        deny()
    return ids


def review(policy, uid, request):
    policy.owner(uid)
    closed(request, {"pendingOffer", "finalOffer", "certificateChain"}, maximum=131072)
    # A Root-bootstrapped current domain is mandatory, even with issuance/release off.
    policy.store.transact(policy.state)
    config, now = policy.config, policy.now()
    pending = closed(request["pendingOffer"], PENDING)
    draft = closed(pending["draft"], DRAFT)
    for name in [
        "ownerSubject",
        "vaultId",
        "issuer",
        "audience",
        "provider",
        "providerClientId",
        "kmsRecoveryKey",
    ]:
        if draft[name] != config.public[name]:
            deny()
    if (
        draft["policyJwk"] != config.policy_jwk
        or config.client(draft["clientId"]) is None
        or draft["identityEpoch"] != 1
        or type(draft["identityEpoch"]) is not int
    ):
        deny()
    for name in ["connectionId", "agentId", "clientId"]:
        validate_schema("Identifier", draft[name])
    recipient_ids = draft["recipientKeyIds"]
    if type(recipient_ids) is not list or not 1 <= len(recipient_ids) <= 16:
        deny()
    for key in recipient_ids:
        b64url_decode(key, exact_bytes=32)
    if recipient_ids != sorted(set(recipient_ids)):
        deny()
    scope(draft["scope"])
    creation, runtime = (validate_workload(draft[k]) for k in ["creationWorkload", "workload"])
    if (
        creation["args"] != ["python", "-m", "app.main"]
        or runtime["args"] != creation["args"]
        or creation["attestationAudience"] != config.issuer + "/enrollment"
        or runtime["attestationAudience"] != config.issuer + "/attestation"
        or creation["serviceAccount"] == runtime["serviceAccount"]
        or any(
            creation[k] != runtime[k]
            for k in [
                "projectId",
                "projectNumber",
                "zone",
                "instanceName",
                "imageDigest",
                "hwmodel",
            ]
        )
        or draft["snapshotBucket"] != runtime["projectId"] + "-executor-state"
    ):
        deny()
    permit = control(
        pending["permit"], config.root_jwk, "initialize", {"draftDigest"}, now, fresh=False
    )
    if (
        pending["profile"] != EXECUTOR
        or permit["draftDigest"] != digest(draft)
        or pending["enrollmentId"]
        != digest(
            {k: draft[k] for k in ["ownerSubject", "vaultId", "connectionId", "identityEpoch"]}
        )
    ):
        deny()
    ids = original_keys(pending, draft["audience"])
    if jwk_thumbprint(config.root_jwk) in ids or jwk_thumbprint(config.policy_jwk) in ids:
        deny()
    statement = {
        "profile": EXECUTOR,
        "action": "offer",
        "issuer": config.issuer,
        "permitFingerprint": signing_input_fingerprint(pending["permit"]),
        "offerDigest": digest({k: v for k, v in pending.items() if k != "creationAttestation"}),
    }
    offer, stage = pending, "pending"
    final = request["finalOffer"]
    if final is not None:
        offer, stage = closed(final, FINAL), "final"
        command = control(
            final["finalization"],
            config.root_jwk,
            "finalize",
            {"offerDigest", "bindingFingerprint", "workload"},
            now,
            fresh=False,
        )
        for name in [
            "agentSigningJwk",
            "agentEncryptionJwk",
            "tlsJwk",
            "certificateRequest",
            "permit",
        ]:
            if final[name] != pending[name]:
                deny()
        workload = validate_workload(final["workload"])
        if (
            final["profile"] != EXECUTOR
            or final["offerDigest"] != digest(pending)
            or command["offerDigest"] != digest(pending)
            or command["workload"] != workload
            or {**runtime, "environment": workload["environment"]} != workload
        ):
            deny()
        binding = validate_executor_schema("ExecutorBinding", final["binding"])
        expected = {
            k: draft[k]
            for k in [
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
                "recipientKeyIds",
            ]
        }
        expected.update(
            bindingFingerprint=command["bindingFingerprint"],
            rootKeyId=jwk_thumbprint(config.root_jwk),
            policySigningKeyId=jwk_thumbprint(config.policy_jwk),
            agentSigningKeyId=ids[0],
            agentEncryptionKeyId=ids[1],
            tlsKeyId=ids[2],
            scopeDigest=digest(draft["scope"]),
            workloadDigest=digest(workload),
        )
        if binding != expected:
            deny()
        validate_schema("Digest", final["initialStateHead"])
        b64url_decode(final["wrappedStateKey"], max_bytes=8192)
        statement.update(
            action="finalize",
            offerDigest=digest(pending),
            finalizationFingerprint=signing_input_fingerprint(final["finalization"]),
            binding=binding,
            initialStateHead=final["initialStateHead"],
            wrappedKeyDigest=digest(final["wrappedStateKey"]),
            csrDigest=digest(final["certificateRequest"]),
        )
    chain = request["certificateChain"]
    if chain is not None and stage != "final":
        deny()
    cert_digest = (
        None
        if chain is None
        else certificate_digest(chain, offer["tlsJwk"], draft["audience"], now=now)
    )
    evidence = closed(offer["creationAttestation"], {"statement", "token"}, maximum=32768)
    if evidence["statement"] != statement:
        deny()
    proof = policy.attestor.verify(evidence["token"], statement, creation)
    # Recheck the actual witness after the external verification, before signing.
    policy.store.transact(policy.state)
    payload = {
        "profile": REVIEW,
        "stage": stage,
        "domain": config.domain,
        "ownerSubject": config.owner,
        "vaultId": config.public["vaultId"],
        "rootKeyId": jwk_thumbprint(config.root_jwk),
        "policySigningKeyId": jwk_thumbprint(config.policy_jwk),
        "pendingOfferDigest": digest(pending),
        "offerDigest": digest(offer),
        "draftDigest": digest(draft),
        "creationWorkloadDigest": digest(creation),
        "statementDigest": digest(statement),
        "certificateDigest": cert_digest,
        "instanceId": proof["instanceId"],
        "issuedAt": now,
        "expiresAt": now + 120,
    }
    return {"review": policy.signer.sign(payload)}


def certificate_digest(raw, tls_jwk, audience, *, now):
    if type(raw) is not str or not 1 <= len(raw) <= 16384:
        deny()
    try:
        certs = x509.load_pem_x509_certificates(raw.encode())
        if not 1 <= len(certs) <= 5:
            deny()
        key = jwk.JWK.from_pem(
            certs[0]
            .public_key()
            .public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
            )
        )
        pub = key.export(private_key=False, as_dict=True)
        if jwk_thumbprint({k: pub[k] for k in ("kty", "crv", "x", "y")}) != jwk_thumbprint(tls_jwk):
            deny()
        import ipaddress

        hostname = urlsplit(audience).hostname
        try:
            san = x509.IPAddress(ipaddress.ip_address(hostname))
        except ValueError:
            san = x509.DNSName(hostname)
        if list(certs[0].extensions.get_extension_for_class(x509.SubjectAlternativeName).value) != [
            san
        ]:
            deny()
        from pathlib import Path

        roots = x509.load_pem_x509_certificates(Path(certifi.where()).read_bytes())
        verifier = (
            PolicyBuilder()
            .store(Store(roots))
            .time(datetime.fromtimestamp(now, UTC))
            .build_server_verifier(san)
        )
        verifier.verify(certs[0], certs[1:])
        return hashlib.sha256(raw.encode()).hexdigest()
    except Exception:
        deny()


def certificate_review(policy, uid, connection, request):
    policy.owner(uid)
    closed(request, {"certificateChain"}, maximum=17408)

    def baseline(state):
        policy.state(state)
        c = policy.connection(state, connection)
        if c["status"] != "active":
            deny()
        return {
            "binding": c["binding"],
            "tlsJwk": c["enrollment"]["tlsJwk"],
            "stateVersion": c["stateVersion"],
            "stateHead": c["stateHead"],
        }

    before = policy.store.transact(baseline)
    now = policy.now()
    cert = certificate_digest(
        request["certificateChain"], before["tlsJwk"], before["binding"]["audience"], now=now
    )
    if policy.store.transact(baseline) != before:
        deny("version_conflict")
    return {
        "review": policy.signer.sign(
            {
                "profile": "folioview.executor-certificate-review.v1",
                "domain": policy.config.domain,
                "bindingDigest": digest(before["binding"]),
                "certificateDigest": cert,
                "stateVersion": before["stateVersion"],
                "stateHead": before["stateHead"],
                "issuedAt": now,
                "expiresAt": now + 120,
            }
        )
    }
