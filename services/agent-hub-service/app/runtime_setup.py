"""Opaque first-pairing intents bound to authenticated native clients.

Client association and key possession do not attest protected-host lifecycle.
This producer never creates certificates, resource permission or execution rights.
"""

import secrets
from urllib.parse import urlencode

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    jwk_thumbprint,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .native_transport import NativeUnit
from .persistent_agents import linked_connection, snapshot, stored_identity
from .store import StoreUnavailable, document_path
from .vaults import _current, identifier

PROFILE = "folioview.runtime-pairing.v1"
INTENT_SECONDS = 1800
MAX_OFFERS = 1


def intent_path(intent):
    return document_path("hub_runtime_setup_intents", intent)


def head_path(owner, vault, connection):
    return document_path("hub_runtime_setup_heads", owner, vault, connection)


class RuntimeSetupService:
    def __init__(self, native):
        self.native, self.store = native, native.store

    def now(self):
        return self.native.now()

    def _intent(self, unit, intent, *, current=True):
        validate_schema("OperationIdentifier", intent)
        row = unit.get(intent_path(intent))
        if row is None:
            raise ContractError("not_found")
        if (
            type(row) is not dict
            or set(row)
            != {
                "intentId",
                "ownerSubject",
                "vaultId",
                "connectionId",
                "clientId",
                "authorizationId",
                "nonce",
                "issuedAt",
                "expiresAt",
                "offer",
                "confirmed",
                "paired",
            }
            or row["intentId"] != intent
        ):
            raise StoreUnavailable
        if (
            type(row["confirmed"]) is not bool
            or type(row["issuedAt"]) is not int
            or type(row["expiresAt"]) is not int
            or not 0 <= row["issuedAt"] < row["expiresAt"] <= row["issuedAt"] + INTENT_SECONDS
        ):
            raise StoreUnavailable
        for key in ("ownerSubject", "vaultId", "connectionId", "clientId", "authorizationId"):
            identifier(row[key])
        b64url_decode(row["nonce"], exact_bytes=32)
        if current and row["expiresAt"] <= self.now():
            raise ContractError("key_authorization_required")
        conn = linked_connection(
            unit, row["ownerSubject"], row["vaultId"], row["connectionId"], active=current
        )
        if current and (
            conn["authorizationId"] != row["authorizationId"]
            or conn["clientId"] != row["clientId"]
            or conn.get("transportKind") != "persistent_runtime"
        ):
            raise ContractError("key_authorization_required")
        return row

    def _public(self, row):
        return {
            k: row[k]
            for k in (
                "intentId",
                "ownerSubject",
                "vaultId",
                "connectionId",
                "clientId",
                "authorizationId",
                "nonce",
                "issuedAt",
                "expiresAt",
                "confirmed",
            )
        }

    def bootstrap(self, token):
        ident = "setup_" + secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)

        def write(raw):
            unit = NativeUnit(raw)
            p = self.native.principal(unit, token)
            vault, _ = _current(unit, p.owner_subject, self.now(), p.vault_id)
            identity = stored_identity(unit, p.owner_subject, p.vault_id, p.connection_id)
            actor = {
                "ownerSubject": p.owner_subject,
                "vaultId": p.vault_id,
                "connectionId": p.connection_id,
                "clientId": p.client_id,
            }
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "actor": actor,
                "rootKeyId": vault["rootKeyId"],
            }
            if identity is not None:
                return {
                    **result,
                    "mode": "resume" if identity["identity"]["status"] == "active" else "revoked",
                    "identity": identity["identity"],
                    "runtimeUrl": self.native.config.base.issuer
                    + "/agent/v3/runtime/controller.html#"
                    + urlencode(
                        {
                            **actor,
                            "rootKeyId": vault["rootKeyId"],
                            "descriptor": b64url_encode(canonical_json(identity["identity"])),
                        }
                    ),
                    "setup": None,
                }
            head = unit.get(head_path(p.owner_subject, p.vault_id, p.connection_id))
            old = None if head is None else self._intent(unit, head["intentId"], current=False)
            if (
                old is not None
                and old["expiresAt"] > self.now()
                and old["authorizationId"] == p.authorization_id
            ):
                row = old
            else:
                row = {
                    "intentId": ident,
                    **actor,
                    "authorizationId": p.authorization_id,
                    "nonce": nonce,
                    "issuedAt": self.now(),
                    "expiresAt": self.now() + INTENT_SECONDS,
                    "offer": None,
                    "confirmed": False,
                    "paired": None,
                }
                unit.put(intent_path(ident), row)
                unit.put(
                    head_path(p.owner_subject, p.vault_id, p.connection_id), {"intentId": ident}
                )
            return {
                **result,
                "mode": "setup",
                "identity": None,
                "runtimeUrl": self.native.config.base.issuer
                + "/agent/v3/runtime/controller.html#"
                + urlencode({"setup": row["intentId"], "rootKeyId": vault["rootKeyId"]}),
                "setup": self._public(row),
            }

        return self.store.transact(write)

    def public_state(self, intent):
        def read(unit):
            row = self._intent(unit, intent)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "setup": self._public(row),
                "offerFingerprint": None if row["offer"] is None else row["offer"]["fingerprint"],
                "paired": row["paired"],
            }

        return self.store.transact(read)

    def offer(self, intent, signed):
        validate_schema("SignedObject", signed)
        if len(canonical_json(signed)) > 16384:
            raise ContractError("payload_too_large")
        _, payload = _signed_parts(signed)
        required = {
            "contractVersion",
            "profile",
            "artifactType",
            "intentId",
            "ownerSubject",
            "vaultId",
            "connectionId",
            "clientId",
            "authorizationId",
            "nonce",
            "issuedAt",
            "expiresAt",
            "agentId",
            "signingPublicJwk",
            "encryptionPublicJwk",
        }
        if (
            type(payload) is not dict
            or set(payload) != required
            or payload["contractVersion"] != CONTRACT_VERSION
            or payload["profile"] != PROFILE
            or payload["artifactType"] != "runtime_key_offer"
        ):
            raise ContractError("malformed_request")
        for name in ("signingPublicJwk", "encryptionPublicJwk"):
            validate_schema("PublicJWK", payload[name])
        sig, enc = (
            jwk_thumbprint(payload["signingPublicJwk"]),
            jwk_thumbprint(payload["encryptionPublicJwk"]),
        )
        if sig == enc or payload["agentId"] != "agent_" + sig:
            raise ContractError("recipient_binding_mismatch")
        verify_jws(signed, payload["signingPublicJwk"], typ="fv-control+jws", expected_kid=sig)
        fingerprint = signing_input_fingerprint(signed)

        def write(unit):
            row = self._intent(unit, intent)
            for key in (
                "intentId",
                "ownerSubject",
                "vaultId",
                "connectionId",
                "clientId",
                "authorizationId",
                "nonce",
            ):
                if row[key] != payload[key]:
                    raise ContractError("recipient_binding_mismatch")
            if row["offer"] is not None:
                if row["offer"]["fingerprint"] != fingerprint:
                    raise ContractError("idempotency_conflict")
                return {
                    "contractVersion": CONTRACT_VERSION,
                    "profile": PROFILE,
                    "intentId": intent,
                    "offerFingerprint": fingerprint,
                }
            if (
                type(payload["issuedAt"]) is not int
                or type(payload["expiresAt"]) is not int
                or not row["issuedAt"]
                <= payload["issuedAt"]
                <= self.now()
                < payload["expiresAt"]
                <= min(payload["issuedAt"] + 300, row["expiresAt"])
            ):
                raise ContractError("key_authorization_required")
            b64url_decode(payload["nonce"], exact_bytes=32)
            row["offer"] = {
                "command": snapshot(signed),
                "fingerprint": fingerprint,
                "agentId": payload["agentId"],
                "signingKeyId": sig,
                "encryptionKeyId": enc,
            }
            unit.put(intent_path(intent), row)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "intentId": intent,
                "offerFingerprint": fingerprint,
            }

        return self.store.transact(write)

    def confirm(self, token, intent, fingerprint):
        validate_schema("Digest", fingerprint)

        def write(raw):
            unit = NativeUnit(raw)
            p = self.native.principal(unit, token)
            row = self._intent(unit, intent)
            if any(
                row[k] != v
                for k, v in {
                    "ownerSubject": p.owner_subject,
                    "vaultId": p.vault_id,
                    "connectionId": p.connection_id,
                    "clientId": p.client_id,
                    "authorizationId": p.authorization_id,
                }.items()
            ):
                raise ContractError("not_found")
            if row["offer"] is None or row["offer"]["fingerprint"] != fingerprint:
                raise ContractError("recipient_binding_mismatch")
            row["confirmed"] = True
            unit.put(intent_path(intent), row)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "intentId": intent,
                "offerFingerprint": fingerprint,
                "clientAssociated": True,
                "protectedHostAttested": False,
            }

        return self.store.transact(write)

    def owner_state(self, uid, intent):
        def read(unit):
            row = self._intent(unit, intent)
            if row["ownerSubject"] != owner_key(uid):
                raise ContractError("not_found")
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "setup": self._public(row),
                "offer": row["offer"],
                "protectedHostAttested": False,
                "authority": "pairing_observation_only",
            }

        return self.store.transact(read)

    def complete(self, uid, intent):
        def write(unit):
            row = self._intent(unit, intent)
            if row["ownerSubject"] != owner_key(uid):
                raise ContractError("not_found")
            if not row["confirmed"] or row["offer"] is None:
                raise ContractError("key_authorization_required")
            v, registry = _current(unit, row["ownerSubject"], self.now(), row["vaultId"])
            saved = stored_identity(unit, row["ownerSubject"], row["vaultId"], row["connectionId"])
            if saved is None:
                raise ContractError("key_authorization_required")
            identity = saved["identity"]
            offer = row["offer"]
            if identity["status"] != "active" or any(
                identity[k] != value
                for k, value in {
                    "clientId": row["clientId"],
                    "agentId": offer["agentId"],
                    "agentSigningKeyId": offer["signingKeyId"],
                    "agentEncryptionKeyId": offer["encryptionKeyId"],
                }.items()
            ):
                raise ContractError("recipient_binding_mismatch")
            from folioview_shared.encrypted.persistent_agents import _agent_keys

            _agent_keys(identity, registry, self.now())
            if row["paired"] is None:
                row["paired"] = {
                    "identity": identity,
                    "rootJwk": v["rootJwk"],
                    "acceptedAt": self.now(),
                    "authority": "pairing_observation_only",
                }
                unit.put(intent_path(intent), row)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "paired": row["paired"],
            }

        return self.store.transact(write)
