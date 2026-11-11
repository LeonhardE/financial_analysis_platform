"""Read only the historical pending locator needed to retire an unpaired browser slot."""

from folioview_shared.encrypted.schema import validate_schema

from .store import StoreUnavailable, document_path


def unpaired_browser_slot(unit, owner, vault, connection):
    head = unit.get(
        document_path("hub_runtime_setup_heads", owner, vault, connection["connectionId"])
    )
    if head is None:
        return False
    if type(head) is not dict or set(head) != {"intentId"}:
        raise StoreUnavailable
    validate_schema("OperationIdentifier", head["intentId"])
    row = unit.get(document_path("hub_runtime_setup_intents", head["intentId"]))
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
        or row["intentId"] != head["intentId"]
        or row["ownerSubject"] != owner
        or row["vaultId"] != vault
        or row["connectionId"] != connection["connectionId"]
        or row["clientId"] != connection["clientId"]
        or row["paired"] is not None
        or type(row["confirmed"]) is not bool
        or type(row["issuedAt"]) is not int
        or type(row["expiresAt"]) is not int
        or not 0 <= row["issuedAt"] < row["expiresAt"] <= row["issuedAt"] + 1800
    ):
        raise StoreUnavailable
    return True
