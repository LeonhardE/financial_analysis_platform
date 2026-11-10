"""Original-key recovery and current-policy state CAS inside the measured boundary."""

import threading
import time

from jwcrypto import jwk

from folioview_shared.encrypted.executor_trust import validate_executor_schema
from folioview_shared.encrypted.jsonutil import b64url_encode

from .contracts import (
    POLICY,
    Stopped,
    clone,
    closed,
    digest,
    operation_id,
    require,
    safe,
)
from .policy import open_secret
from .state import public, seal, unseal, validate_state
from .tls import certificate


class Executor:
    def __init__(self, config, policy, attestation, snapshots, *, clock=time.time):
        self.config, self.policy, self.attestation, self.snapshots, self.clock = (
            config,
            policy,
            attestation,
            snapshots,
            clock,
        )
        self.boot = operation_id()
        self._key = self._state = self._keys = self.head = self.generation = None
        self._lock = threading.RLock()

    def stop(self):
        # Python does not promise deterministic zeroization; process termination is
        # the final memory boundary. No export/logging of these references exists.
        self._key = self._state = self._keys = self.head = self.generation = None

    def _operation(self, request):
        return {
            "bindingDigest": digest(self.config.binding),
            "runId": "restore_" + self.boot,
            "operationId": operation_id(),
            "requestDigest": digest(request),
        }

    def _challenge(
        self, purpose, operation, resources, key, ephemeral, *, access=None, workload=False
    ):
        request = {
            "purpose": purpose,
            "operation": operation,
            "resourceBindings": resources,
            "bootId": self.boot,
            "releaseRecipientJwk": public(ephemeral),
        }
        result = self.policy.call("challenges", request, key, access=access, workload=workload)
        closed(result, {"profile", "challenge", "statement", "checkpoint", "encryptionChallenge"})
        cp = self.policy.checkpoint(result["checkpoint"])
        challenge = validate_executor_schema("ExecutorChallenge", result["challenge"])
        require(
            challenge["bindingDigest"] == digest(self.config.binding)
            and challenge["purpose"] == purpose
            and challenge["issuedAt"]
            <= int(self.clock())
            < challenge["expiresAt"]
            <= challenge["issuedAt"] + 120
        )
        expected = {
            "profile": POLICY,
            "binding": self.config.binding,
            "challenge": challenge,
            "operation": operation,
            "resourceBindings": resources,
            "bootId": self.boot,
            "releaseRecipientJwk": public(ephemeral),
            "stateHead": cp["stateHead"],
            "authorizationEpoch": cp["authorizationEpoch"],
            "certificateDigest": certificate(self.config, now=int(self.clock())),
            "authorizationMode": "workload_recovery" if workload else "account",
        }
        require(result["statement"] == expected)
        return result, cp

    def restore(self):
        with self._lock:
            self.stop()
            try:
                return safe(self._restore)
            except Exception:
                self.stop()
                raise Stopped from None

    def _restore(self):
        ephemeral = jwk.JWK.generate(kty="EC", crv="P-256")
        operation = self._operation({"boot": self.boot, "purpose": "recover"})
        ch, before = self._challenge("recover", operation, [], ephemeral, ephemeral, workload=True)
        request = {
            "challengeId": ch["challenge"]["challengeId"],
            "attestationToken": self.attestation.issue(ch["statement"]),
            "encryptionAnswer": None,
            "tlsProof": None,
        }
        response = self.policy.call("releases", request, ephemeral, workload=True)
        cp = self.policy.verify_lease(response, ch["challenge"], operation, "recover")
        require(
            cp["stateHead"] == before["stateHead"]
            and cp["authorizationEpoch"] > before["authorizationEpoch"]
        )
        key = open_secret(
            response["sealedRecoveryKey"],
            ephemeral,
            {
                "bindingDigest": digest(self.config.binding),
                "stateHead": cp["stateHead"],
                "generation": response["generation"],
                "challengeId": request["challengeId"],
            },
        )
        state = unseal(self.snapshots.read(cp["stateHead"]), key, self.config.binding)
        keys = validate_state(state, self.config.binding)
        answer = b64url_encode(
            open_secret(ch["encryptionChallenge"], keys["encryption"], ch["statement"])
        )
        path = "/workload/v1/connections/" + self.config.connection + "/confirm"
        confirm = {
            "challengeId": request["challengeId"],
            "encryptionAnswer": answer,
            "tlsProof": self.policy.proof(
                path, {"statement": ch["statement"], "encryptionAnswer": answer}, keys["tls"]
            ),
        }
        confirmed = self.policy.call("confirm", confirm, keys["signing"], workload=True)
        closed(confirmed, {"profile", "generation", "stateHead", "checkpoint"})
        current = self.policy.checkpoint(confirmed["checkpoint"])
        require(
            current == cp
            and confirmed["stateHead"] == cp["stateHead"]
            and confirmed["generation"] == response["generation"]
        )
        self._key, self._state, self._keys = key, state, keys
        self.head, self.generation = cp["stateHead"], confirmed["generation"]
        return self.identity()

    def identity(self):
        require(self._keys is not None)
        return {
            "profile": "folioview.agent-executor.v1",
            "connectionId": self.config.connection,
            "identityEpoch": self.config.binding["identityEpoch"],
            "agentSigningJwk": public(self._keys["signing"]),
            "agentEncryptionJwk": public(self._keys["encryption"]),
            "tlsJwk": public(self._keys["tls"]),
            "stateHead": self.head,
        }

    def current(self, access):
        require(self._keys is not None)
        result = self.policy.call("checkpoint", {}, self._keys["signing"], access=access)
        closed(
            result,
            {"profile", "approval", "binding", "checkpoint", "stateHead", "receipts"},
            maximum=131072,
        )
        require(result["binding"] == self.config.binding)
        cp = self.policy.checkpoint(result["checkpoint"], result["approval"])
        require(
            cp["stateHead"] == self.head
            and cp["authorizationEpoch"] == self.generation
            and result["stateHead"] == self.head
        )
        return result, cp

    def authorize(self, access, purpose, operation, resources):
        """Internal one-operation guard; consumers recheck immediately before use."""
        with self._lock:

            def authorize():
                require(purpose in {"execute", "write_report"} and self._keys is not None)
                validate_executor_schema("ExecutorOperation", operation)
                require(operation["bindingDigest"] == digest(self.config.binding))
                allowed = self.config.public["scope"]["resourceBindings"]
                require(
                    type(resources) is list
                    and len(resources) <= 10
                    and all(r in allowed for r in resources)
                    and len({digest(r) for r in resources}) == len(resources)
                )
                self.current(access)
                ephemeral = jwk.JWK.generate(kty="EC", crv="P-256")
                ch, cp = self._challenge(
                    purpose, operation, resources, self._keys["signing"], ephemeral, access=access
                )
                require(
                    cp["stateHead"] == self.head and cp["authorizationEpoch"] == self.generation
                )
                answer = b64url_encode(
                    open_secret(
                        ch["encryptionChallenge"], self._keys["encryption"], ch["statement"]
                    )
                )
                path = "/v1/connections/" + self.config.connection + "/leases"
                request = {
                    "challengeId": ch["challenge"]["challengeId"],
                    "attestationToken": self.attestation.issue(ch["statement"]),
                    "encryptionAnswer": answer,
                    "tlsProof": self.policy.proof(
                        path,
                        {"statement": ch["statement"], "encryptionAnswer": answer},
                        self._keys["tls"],
                    ),
                }
                response = self.policy.call("leases", request, self._keys["signing"], access=access)
                granted = self.policy.verify_lease(response, ch["challenge"], operation, purpose)
                _, current = self.current(access)
                require(current == granted and response["sealedRecoveryKey"] is None)
                return response

            return safe(authorize)

    def persist(self, access, operation, next_state, receipt):
        """Upload ciphertext before Policy CAS; an unknown commit stops this process.

        The next boot loads the Policy-selected head, including the exact outbox.
        No local pointer or automatic same-identity initialization exists.
        """
        with self._lock:
            require(self._state is not None)
            validate_executor_schema("ExecutorReceipt", receipt)
            require(receipt["operation"] == operation)
            validate_state(next_state, self.config.binding)
            require(
                next_state["sequence"] == self._state["sequence"] + 1
                and next_state["keys"] == self._state["keys"]
            )
            grant = self.authorize(access, "write_report", operation, [])
            next_head = self.snapshots.put(seal(next_state, self._key, self.config.binding))
            expected_head = self.head
            request = {
                "lease": grant["lease"],
                "expectedHead": expected_head,
                "nextHead": next_head,
                "receipt": receipt,
            }
            try:
                result = self.policy.call("commits", request, self._keys["signing"], access=access)
                closed(result, {"receipt", "expectedHead", "nextHead"})
                require(
                    result
                    == {"receipt": receipt, "expectedHead": expected_head, "nextHead": next_head}
                )
                # Re-read the live policy; commit invalidates the preceding lease.
                live = self.policy.call("checkpoint", {}, self._keys["signing"], access=access)
                cp = self.policy.checkpoint(live["checkpoint"], live["approval"])
                require(cp["stateHead"] == next_head and cp["authorizationEpoch"] > self.generation)
            except Exception:
                self.stop()
                raise Stopped from None
            self.head, self.generation, self._state = (
                next_head,
                cp["authorizationEpoch"],
                clone(next_state),
            )
            return clone(result)

    def snapshot_state(self, access):
        """Private in-process state access, guarded by a fresh current account check."""
        with self._lock:
            self.current(access)
            return clone(self._state)
