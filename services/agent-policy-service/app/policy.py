"""Owner-rooted policy state, fresh leases and key-only attested recovery."""

import secrets
import time

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    jwk_thumbprint,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.executor_trust import (
    EXECUTOR_TRUST_PROFILE,
    validate_executor_schema,
    verify_executor_approval,
    verify_executor_transition,
)
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .attestation import seal_secret, validate_workload
from .contracts import (
    PROFILE,
    Unavailable,
    closed,
    copy,
    deny,
    digest,
    identifier,
    number,
    random,
    recovery_aad,
    root_control,
    scope,
)

MAX_CONNECTIONS = 8
MAX_OPERATIONS = 256
MAX_CHALLENGES = 16


class Policy:
    def __init__(self, config, store, signer, attestor, *, clock=time.time):
        self.config, self.store, self.signer, self.attestor, self.clock = (
            config,
            store,
            signer,
            attestor,
            clock,
        )

    def now(self):
        value = self.clock()
        if type(value) not in {int, float} or not 1 <= value <= 253402300799:
            raise Unavailable
        return int(value)

    def owner(self, uid):
        if type(uid) is not str or owner_key(uid) != self.config.owner:
            deny()

    def active(self):
        if not self.config.enabled:
            raise Unavailable

    def state(self, state):
        closed(
            state,
            {
                "domain",
                "sequence",
                "previous",
                "connections",
                "pending",
                "codes",
                "families",
                "access",
                "controls",
                "audit",
            },
            maximum=524288,
        )
        if state["domain"] != self.config.domain:
            raise Unavailable
        for k, maximum in {
            "connections": 8,
            "pending": 16,
            "codes": 64,
            "families": 64,
            "access": 128,
            "controls": 256,
        }.items():
            if type(state[k]) is not dict or len(state[k]) > maximum:
                raise Unavailable
        if type(state["audit"]) is not list or len(state["audit"]) > 32:
            raise Unavailable
        return state

    def bootstrap(self, signed):
        params = {"domain": self.config.domain}
        root_control(
            signed,
            self.config,
            action="bootstrap",
            connection="policy",
            version=0,
            head=None,
            parameters=params,
            now=self.now(),
        )
        self.store.bootstrap(
            {
                "domain": self.config.domain,
                "sequence": 1,
                "previous": None,
                "connections": {},
                "pending": {},
                "codes": {},
                "families": {},
                "access": {},
                "controls": {},
                "audit": [{"action": "bootstrap", "digest": digest(signed), "at": self.now()}],
            }
        )

    def audit(self, state, action, connection, operation):
        state["audit"] = (
            state["audit"]
            + [
                {
                    "action": action,
                    "connectionId": connection,
                    "digest": digest(operation),
                    "at": self.now(),
                }
            ]
        )[-32:]

    def connection(self, state, connection, *, active=False):
        self.state(state)
        identifier(connection)
        conn = state["connections"].get(connection)
        if conn is None:
            deny("not_found")
        closed(
            conn,
            {
                "enrollment",
                "approval",
                "binding",
                "status",
                "authorizationEpoch",
                "stateVersion",
                "stateHead",
                "checkpoint",
                "active",
                "challenges",
                "operations",
                "bootstrapUntil",
            },
            maximum=393216,
        )
        expected = self.enrollment_binding(conn["enrollment"], connection)
        if conn["binding"] != expected:
            raise Unavailable
        for k in ("authorizationEpoch", "stateVersion"):
            number(conn[k])
        number(conn["bootstrapUntil"], minimum=0)
        validate_schema("Digest", conn["stateHead"])
        if (
            conn["status"] not in {"active", "revoked"}
            or type(conn["challenges"]) is not dict
            or len(conn["challenges"]) > MAX_CHALLENGES
            or type(conn["operations"]) is not dict
            or len(conn["operations"]) > MAX_OPERATIONS
        ):
            raise Unavailable
        if active:
            self.active()
            if conn["status"] != "active":
                deny()
            verify_executor_approval(
                conn["approval"],
                expected_binding=expected,
                root_jwk=self.config.root_jwk,
                now=self.now(),
            )
        return conn

    def enrollment_binding(self, e, connection):
        closed(
            e,
            {
                "agentId",
                "clientId",
                "identityEpoch",
                "bindingFingerprint",
                "agentSigningJwk",
                "agentEncryptionJwk",
                "tlsJwk",
                "scope",
                "recipientKeyIds",
                "workload",
                "initialStateHead",
                "certificateDigest",
                "wrappedStateKey",
            },
            maximum=49152,
        )
        for k in ("agentId", "clientId"):
            identifier(e[k])
        if self.config.client(e["clientId"]) is None:
            deny()
        number(e["identityEpoch"])
        for k in ("bindingFingerprint", "initialStateHead", "certificateDigest"):
            validate_schema("Digest", e[k])
        for k in ("agentSigningJwk", "agentEncryptionJwk", "tlsJwk"):
            validate_schema("PublicJWK", e[k])
        b64url_decode(e["wrappedStateKey"], max_bytes=8192)
        s = scope(e["scope"])
        workload = validate_workload(e["workload"])
        binding = {
            "ownerSubject": self.config.owner,
            "vaultId": self.config.public["vaultId"],
            "rootKeyId": jwk_thumbprint(self.config.root_jwk),
            "connectionId": connection,
            "agentId": e["agentId"],
            "clientId": e["clientId"],
            "identityEpoch": e["identityEpoch"],
            "bindingFingerprint": e["bindingFingerprint"],
            "agentSigningKeyId": jwk_thumbprint(e["agentSigningJwk"]),
            "agentEncryptionKeyId": jwk_thumbprint(e["agentEncryptionJwk"]),
            "tlsKeyId": jwk_thumbprint(e["tlsJwk"]),
            "policySigningKeyId": jwk_thumbprint(self.config.policy_jwk),
            "scopeDigest": digest(s),
            "recipientKeyIds": e["recipientKeyIds"],
            "workloadDigest": digest(workload),
            **{
                k: self.config.public[k]
                for k in ("issuer", "audience", "provider", "providerClientId")
            },
        }
        validate_executor_schema("ExecutorBinding", binding)
        return binding

    def control(self, uid, connection, request):
        self.owner(uid)
        closed(request, {"action", "parameters", "approval", "command"})
        action = request["action"]
        parameters = request["parameters"]
        if action not in {"register", "revoke", "transition", "certificate"}:
            deny("malformed_request")
        if action != "revoke":
            self.active()

        def apply(state):
            self.state(state)
            # Exact controls return immutable receipts without replaying authority.
            _, unsigned = _signed_parts(request["command"])
            operation = unsigned.get("operationId")
            validate_schema("OperationIdentifier", operation)
            existing = state["controls"].get(operation)
            if existing is not None:
                if (
                    existing["requestDigest"] != digest(request)
                    or existing["connectionId"] != connection
                ):
                    deny("idempotency_conflict")
                return existing["receipt"]
            if len(state["controls"]) >= 256:
                deny("version_conflict")
            if action == "register":
                if (
                    connection in state["connections"]
                    or len(state["connections"]) >= MAX_CONNECTIONS
                ):
                    deny("version_conflict")
                binding = self.enrollment_binding(parameters, connection)
                control = root_control(
                    request["command"],
                    self.config,
                    action=action,
                    connection=connection,
                    version=0,
                    head=None,
                    parameters={"enrollment": parameters, "approval": request["approval"]},
                    now=self.now(),
                )
                approval = verify_executor_approval(
                    request["approval"],
                    expected_binding=binding,
                    root_jwk=self.config.root_jwk,
                    now=self.now(),
                )
                if approval["operationId"] != operation or binding["identityEpoch"] != 1:
                    deny()
                conn = {
                    "enrollment": copy(parameters),
                    "approval": copy(request["approval"]),
                    "binding": binding,
                    "status": "active",
                    "authorizationEpoch": 1,
                    "stateVersion": 1,
                    "stateHead": parameters["initialStateHead"],
                    "checkpoint": None,
                    "active": None,
                    "challenges": {},
                    "operations": {},
                    "bootstrapUntil": control["expiresAt"],
                }
                state["connections"][connection] = conn
            else:
                conn = self.connection(state, connection)
                control = root_control(
                    request["command"],
                    self.config,
                    action=action,
                    connection=connection,
                    version=conn["stateVersion"],
                    head=conn["stateHead"],
                    parameters={"parameters": parameters, "approval": request["approval"]},
                    now=self.now(),
                )
                if action == "revoke":
                    if parameters != {} or request["approval"] is not None:
                        deny("malformed_request")
                    conn["status"] = "revoked"
                elif action == "certificate":
                    closed(parameters, {"certificateDigest"})
                    validate_schema("Digest", parameters["certificateDigest"])
                    if request["approval"] is not None or conn["status"] != "active":
                        deny()
                    conn["enrollment"]["certificateDigest"] = parameters["certificateDigest"]
                else:
                    if conn["status"] != "active":
                        deny()
                    closed(parameters, {"transition", "enrollment"})
                    next_binding = self.enrollment_binding(parameters["enrollment"], connection)
                    checkpoint = self.checkpoint(conn)
                    verify_executor_transition(
                        parameters["transition"],
                        approval_signed=conn["approval"],
                        checkpoint_signed=checkpoint["signed"],
                        expected_binding=conn["binding"],
                        expected_next_binding=next_binding,
                        root_jwk=self.config.root_jwk,
                        policy_jwk=self.config.policy_jwk,
                        current_checkpoint=checkpoint["payload"],
                        now=self.now(),
                    )
                    verify_executor_approval(
                        request["approval"],
                        expected_binding=next_binding,
                        root_jwk=self.config.root_jwk,
                        now=self.now(),
                    )

                    _, transition_payload = _signed_parts(parameters["transition"])
                    if transition_payload["transitionType"] == "code_upgrade" and (
                        parameters["enrollment"]["initialStateHead"] != conn["stateHead"]
                        or any(
                            parameters["enrollment"][k] != conn["enrollment"][k]
                            for k in ("wrappedStateKey", "certificateDigest")
                        )
                    ):
                        deny("version_conflict")
                    conn.update(
                        enrollment=copy(parameters["enrollment"]),
                        approval=copy(request["approval"]),
                        binding=next_binding,
                        stateHead=parameters["enrollment"]["initialStateHead"],
                    )
                self.bump(conn)
                conn["bootstrapUntil"] = 0 if action == "revoke" else control["expiresAt"]
                conn["active"] = None
                conn["challenges"] = {}
                for family in state["families"].values():
                    if family["connectionId"] == connection:
                        family["revoked"] = True
            receipt = {
                "profile": PROFILE,
                "operationId": operation,
                "connectionId": connection,
                "status": conn["status"],
                "stateVersion": conn["stateVersion"],
                "authorizationEpoch": conn["authorizationEpoch"],
                "bindingDigest": digest(conn["binding"]),
            }
            state["controls"][operation] = {
                "connectionId": connection,
                "requestDigest": digest(request),
                "receipt": receipt,
            }
            self.audit(state, action, connection, request["command"])
            return receipt

        return self.store.transact(apply)

    def bump(self, conn):
        conn["authorizationEpoch"] += 1
        conn["stateVersion"] += 1
        number(conn["authorizationEpoch"])
        number(conn["stateVersion"])
        conn["checkpoint"] = None

    def checkpoint(self, conn):
        now = self.now()
        saved = conn["checkpoint"]
        if saved is None or saved["payload"]["expiresAt"] <= now:
            _, approval = _signed_parts(conn["approval"])
            expires = min(now + 120, approval["expiresAt"])
            if expires <= now:
                deny()
            p = {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_checkpoint",
                "bindingDigest": digest(conn["binding"]),
                "approvalFingerprint": signing_input_fingerprint(conn["approval"]),
                "stateVersion": conn["stateVersion"],
                "stateHead": conn["stateHead"],
                "authorizationEpoch": conn["authorizationEpoch"],
                "revoked": conn["status"] != "active",
                "issuedAt": now,
                "expiresAt": expires,
            }
            validate_executor_schema("ExecutorCheckpointPayload", p)
            saved = {"payload": p, "signed": self.signer.sign(p)}
            conn["checkpoint"] = saved
        return saved

    def owner_state(self, uid, connection):
        self.owner(uid)

        def read(state):
            c = self.connection(state, connection)
            return {
                "profile": PROFILE,
                "connectionId": connection,
                "binding": c["binding"],
                "status": c["status"],
                "stateVersion": c["stateVersion"],
                "stateHead": c["stateHead"],
                "authorizationEpoch": c["authorizationEpoch"],
                "active": c["active"],
                "approval": c["approval"],
                "scope": c["enrollment"]["scope"],
                "certificateDigest": c["enrollment"]["certificateDigest"],
                "checkpoint": None if c["checkpoint"] is None else c["checkpoint"]["signed"],
                "bootstrapUntil": c["bootstrapUntil"],
                "audit": state["audit"],
            }

        return self.store.transact(read)

    def owner_checkpoint(self, uid, connection):
        self.owner(uid)

        def read(state):
            c = self.connection(state, connection, active=True)
            return {"profile": PROFILE, "checkpoint": self.checkpoint(c)["signed"]}

        return self.store.transact(read)

    def agent_proof(self, conn, signed, *, path, body, key="agentSigningJwk", public=None):
        p = verify_jws(signed, public or conn["enrollment"][key], typ="fv-control+jws")
        closed(
            p,
            {
                "profile",
                "purpose",
                "bindingDigest",
                "audience",
                "path",
                "method",
                "bodyDigest",
                "requestId",
                "issuedAt",
                "expiresAt",
            },
            maximum=16384,
        )
        validate_schema("OperationIdentifier", p["requestId"])
        if (
            p["profile"] != PROFILE
            or p["purpose"] != "authenticated_request"
            or p["bindingDigest"] != digest(conn["binding"])
            or p["audience"] != self.config.issuer
            or p["path"] != path
            or p["method"] != "POST"
            or p["bodyDigest"] != digest(body)
            or type(p["issuedAt"]) is not int
            or type(p["expiresAt"]) is not int
            or not p["issuedAt"] <= self.now() < p["expiresAt"] <= p["issuedAt"] + 120
        ):
            deny()
        return p

    def current(self, state, connection, access, *, purpose, workload=False):
        from .oauth import authenticate_access

        c = self.connection(state, connection, active=True)
        if workload:
            if purpose != "recover" or not self.config.release_enabled:
                deny()
            authorized = any(
                not f["revoked"]
                and f["expiresAt"] > self.now()
                and f["connectionId"] == connection
                and f["bindingDigest"] == digest(c["binding"])
                and "executor:recover" in f["scope"].split()
                for f in state["families"].values()
            )
            if not authorized and self.now() >= c["bootstrapUntil"]:
                deny()
        else:
            authenticate_access(self, state, access, c, purpose)
        return c

    def challenge(self, connection, access, proof, path, request, *, workload=False):
        closed(
            request,
            {"purpose", "operation", "resourceBindings", "bootId", "releaseRecipientJwk"},
            maximum=32768,
        )
        purpose = request["purpose"]
        if workload and (purpose != "recover" or request["resourceBindings"] != []):
            deny("insufficient_scope")
        if purpose not in {"execute", "write_report", "recover"}:
            deny("malformed_request")
        validate_executor_schema("ExecutorOperation", request["operation"])
        identifier(request["bootId"])
        validate_schema("PublicJWK", request["releaseRecipientJwk"])

        def issue(state):
            c = self.current(state, connection, access, purpose=purpose, workload=workload)
            self.agent_proof(
                c,
                proof,
                path=path,
                body=request,
                public=request["releaseRecipientJwk"] if purpose == "recover" else None,
            )
            self.operation_scope(c, request)
            c["challenges"] = {
                k: v for k, v in c["challenges"].items() if v["challenge"]["expiresAt"] > self.now()
            }
            if len(c["challenges"]) >= MAX_CHALLENGES:
                deny("version_conflict")
            ch = {
                "bindingDigest": digest(c["binding"]),
                "challengeId": random("pch_"),
                "nonce": b64url_encode(secrets.token_bytes(32)),
                "purpose": purpose,
                "issuedAt": self.now(),
                "expiresAt": self.now() + 120,
            }
            validate_executor_schema("ExecutorChallenge", ch)
            secret = secrets.token_bytes(32)
            cp = self.checkpoint(c)
            statement = {
                "profile": PROFILE,
                "binding": c["binding"],
                "challenge": ch,
                "operation": request["operation"],
                "resourceBindings": request["resourceBindings"],
                "bootId": request["bootId"],
                "releaseRecipientJwk": request["releaseRecipientJwk"],
                "stateHead": c["stateHead"],
                "authorizationEpoch": c["authorizationEpoch"],
                "certificateDigest": c["enrollment"]["certificateDigest"],
                "authorizationMode": "workload_recovery" if workload else "account",
            }
            c["challenges"][ch["challengeId"]] = {
                "challenge": ch,
                "statement": statement,
                "secretHash": digest(b64url_encode(secret)),
                "used": False,
                "response": None,
                "requestDigest": None,
                "checkpoint": copy(cp),
                "workloadRecovery": workload,
            }
            return {
                "profile": PROFILE,
                "challenge": ch,
                "statement": statement,
                "checkpoint": cp["signed"],
                "encryptionChallenge": seal_secret(
                    secret, c["enrollment"]["agentEncryptionJwk"], statement
                ),
            }

        return self.store.transact(issue)

    def operation_scope(self, c, request):
        if request["operation"]["bindingDigest"] != digest(c["binding"]):
            deny()
        bindings = request["resourceBindings"]
        if type(bindings) is not list or len(bindings) > 10:
            deny("malformed_request")
        allowed = c["enrollment"]["scope"]["resourceBindings"]
        for b in bindings:
            validate_schema("ResourceBindingMetadata", b)
        if len({digest(b) for b in bindings}) != len(bindings) or any(
            b not in allowed for b in bindings
        ):
            deny("insufficient_scope")

    def grant(self, connection, access, proof, path, request, *, release=False, workload=False):
        fields = {"challengeId", "attestationToken", "encryptionAnswer", "tlsProof"}
        closed(request, fields, maximum=49152)
        identifier(request["challengeId"])
        if release and not self.config.release_enabled:
            raise Unavailable
        if workload and not release:
            deny()

        # Google/Compute I/O happens outside live-witness CAS; committing callback
        # rechecks every authorization fence and exact challenge afterwards.
        def preflight(state):
            c = self.connection(state, connection, active=True)
            ch = c["challenges"].get(request["challengeId"])
            if ch is None:
                deny("not_found")
            if ch["workloadRecovery"] != workload:
                deny()
            self.current(
                state, connection, access, purpose=ch["challenge"]["purpose"], workload=workload
            )
            self.agent_proof(
                c,
                proof,
                path=path,
                body=request,
                public=ch["statement"]["releaseRecipientJwk"]
                if ch["challenge"]["purpose"] == "recover"
                else None,
            )
            if ch["used"]:
                if ch["requestDigest"] != digest(request):
                    deny("idempotency_conflict")
                if release:
                    self.recovery_retry(c, ch["response"])
                return {"prior": ch["response"]}
            return {"challenge": copy(ch), "workload": c["enrollment"]["workload"]}

        before = self.store.transact(preflight)
        if "prior" in before:
            return before["prior"]
        attested = self.attestor.verify(
            request["attestationToken"], before["challenge"]["statement"], before["workload"]
        )

        def accept(state):
            c = self.connection(state, connection, active=True)
            ch = c["challenges"].get(request["challengeId"])
            if ch is None:
                deny()
            purpose = ch["challenge"]["purpose"]
            if ch["workloadRecovery"] != workload:
                deny()
            self.current(state, connection, access, purpose=purpose, workload=workload)
            proof_key = ch["statement"]["releaseRecipientJwk"] if purpose == "recover" else None
            self.agent_proof(c, proof, path=path, body=request, public=proof_key)
            if ch["used"]:
                if ch["requestDigest"] != digest(request):
                    deny("idempotency_conflict")
                if release:
                    self.recovery_retry(c, ch["response"])
                return ch["response"]
            if (
                ch != before["challenge"]
                or ch["statement"]["stateHead"] != c["stateHead"]
                or ch["statement"]["authorizationEpoch"] != c["authorizationEpoch"]
                or self.now() >= ch["challenge"]["expiresAt"]
            ):
                deny("version_conflict")
            if release != (purpose == "recover"):
                deny()
            if not release:
                if digest(request["encryptionAnswer"]) != ch["secretHash"]:
                    deny()
                self.agent_proof(
                    c,
                    request["tlsProof"],
                    path=path,
                    body={
                        "statement": ch["statement"],
                        "encryptionAnswer": request["encryptionAnswer"],
                    },
                    key="tlsJwk",
                )
                active = c["active"]
                if (
                    active is None
                    or not active["confirmed"]
                    or (active["instanceId"], active["bootId"])
                    != (attested["instanceId"], ch["statement"]["bootId"])
                ):
                    deny()
            else:
                # Bootstrap release is attestation-bound; original keys must be
                # challenged before any execute/write lease is available.
                if request["encryptionAnswer"] is not None or request["tlsProof"] is not None:
                    deny("malformed_request")
                self.bump(c)
                c["active"] = {
                    "instanceId": attested["instanceId"],
                    "bootId": ch["statement"]["bootId"],
                    "generation": c["authorizationEpoch"],
                    "confirmed": False,
                }
            cp = self.checkpoint(c)
            now = self.now()
            lease = {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_lease",
                "bindingDigest": digest(c["binding"]),
                "checkpointDigest": digest(cp["payload"]),
                "challenge": ch["challenge"],
                "operation": ch["statement"]["operation"],
                "issuedAt": now,
                "expiresAt": min(
                    now + 120, ch["challenge"]["expiresAt"], cp["payload"]["expiresAt"]
                ),
            }
            validate_executor_schema("ExecutorLeasePayload", lease)
            response = {
                "profile": PROFILE,
                "approval": c["approval"],
                "checkpoint": cp["signed"],
                "lease": self.signer.sign(lease),
                "generation": c["active"]["generation"],
                "stateHead": c["stateHead"],
                "sealedRecoveryKey": None,
            }
            if release:
                secret = self.signer.unwrap_recovery_key(
                    c["enrollment"]["wrappedStateKey"], recovery_aad(c["binding"])
                )
                response["sealedRecoveryKey"] = seal_secret(
                    secret,
                    ch["statement"]["releaseRecipientJwk"],
                    {
                        "bindingDigest": digest(c["binding"]),
                        "stateHead": c["stateHead"],
                        "generation": c["active"]["generation"],
                        "challengeId": request["challengeId"],
                    },
                )
                secret = None
            self.agent_proof(c, proof, path=path, body=request, public=proof_key)
            if self.now() >= lease["expiresAt"]:
                deny()
            ch.update(used=True, response=response, requestDigest=digest(request))
            self.audit(
                state,
                "recovery_release" if release else "lease",
                connection,
                ch["statement"]["operation"],
            )
            return response

        return self.store.transact(accept)

    def recovery_retry(self, c, response):
        # A sealed key is not a historical receipt: it may be redelivered only
        # inside the original fresh, current authorization/generation window.
        lease = verify_jws(response["lease"], self.config.policy_jwk, typ="fv-control+jws")
        if (
            not lease["issuedAt"] <= self.now() < lease["expiresAt"]
            or c["active"] is None
            or c["active"]["generation"] != response["generation"]
            or lease["checkpointDigest"] != digest(self.checkpoint(c)["payload"])
        ):
            deny()

    def confirm(self, connection, access, proof, path, request, *, workload=False):
        closed(request, {"challengeId", "encryptionAnswer", "tlsProof"}, maximum=32768)

        def apply(state):
            c = self.current(state, connection, access, purpose="recover", workload=workload)
            self.agent_proof(c, proof, path=path, body=request)
            ch = c["challenges"].get(request["challengeId"])
            if (
                ch is None
                or ch["workloadRecovery"] != workload
                or not ch["used"]
                or ch["challenge"]["purpose"] != "recover"
                or self.now() >= ch["challenge"]["expiresAt"]
                or c["active"] is None
                or c["active"]["bootId"] != ch["statement"]["bootId"]
                or c["active"]["generation"] != ch["response"]["generation"]
                or digest(request["encryptionAnswer"]) != ch["secretHash"]
            ):
                deny()
            self.agent_proof(
                c,
                request["tlsProof"],
                path=path,
                body={
                    "statement": ch["statement"],
                    "encryptionAnswer": request["encryptionAnswer"],
                },
                key="tlsJwk",
            )
            c["active"]["confirmed"] = True
            return {
                "profile": PROFILE,
                "generation": c["active"]["generation"],
                "stateHead": c["stateHead"],
                "checkpoint": self.checkpoint(c)["signed"],
            }

        return self.store.transact(apply)

    def checkpoint_read(self, connection, access, proof, path, request):
        if request != {}:
            deny("malformed_request")

        def read(state):
            c = self.current(state, connection, access, purpose=None)
            self.agent_proof(c, proof, path=path, body=request)
            return {
                "profile": PROFILE,
                "approval": c["approval"],
                "binding": c["binding"],
                "checkpoint": self.checkpoint(c)["signed"],
                "stateHead": c["stateHead"],
                "receipts": [v["receipt"] for v in c["operations"].values()][-32:],
            }

        return self.store.transact(read)

    def commit(self, connection, access, proof, path, request):
        closed(request, {"lease", "expectedHead", "nextHead", "receipt"}, maximum=32768)
        validate_schema("Digest", request["nextHead"])
        receipt = validate_executor_schema("ExecutorReceipt", request["receipt"])
        operation = receipt["operation"]
        operation_id = operation["operationId"]

        def save(state):
            c = self.current(state, connection, access, purpose="write_report")
            self.agent_proof(c, proof, path=path, body=request)
            if operation["bindingDigest"] != digest(c["binding"]):
                deny("idempotency_conflict")
            old = c["operations"].get(operation_id)
            if old is not None:
                if (
                    old["receipt"] != receipt
                    or old["nextHead"] != request["nextHead"]
                    or old["expectedHead"] != request["expectedHead"]
                ):
                    deny("idempotency_conflict")
                return old
            lease = verify_jws(request["lease"], self.config.policy_jwk, typ="fv-control+jws")
            validate_executor_schema("ExecutorLeasePayload", lease)
            cp = self.checkpoint(c)
            ch = c["challenges"].get(lease["challenge"]["challengeId"])
            if (
                operation["bindingDigest"] != digest(c["binding"])
                or lease["operation"] != operation
                or lease["checkpointDigest"] != digest(cp["payload"])
                or not lease["issuedAt"] <= self.now() < lease["expiresAt"]
                or ch is None
                or not ch["used"]
                or ch["response"]["lease"] != request["lease"]
                or ch["challenge"]["purpose"] != "write_report"
                or c["active"] is None
                or not c["active"]["confirmed"]
                or request["expectedHead"] != c["stateHead"]
            ):
                deny("version_conflict")
            if len(c["operations"]) >= MAX_OPERATIONS:
                deny("version_conflict")
            old = {
                "receipt": receipt,
                "expectedHead": c["stateHead"],
                "nextHead": request["nextHead"],
            }
            c["operations"][operation_id] = old
            c["stateHead"] = request["nextHead"]
            self.bump(c)
            # Updating the state head fences old leases, but the same confirmed
            # boot still owns the current generation and original keys.
            c["active"]["generation"] = c["authorizationEpoch"]
            self.audit(state, "commit", connection, receipt)
            return old

        return self.store.transact(save)
