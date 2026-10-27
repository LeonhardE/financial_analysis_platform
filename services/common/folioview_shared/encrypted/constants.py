"""Stable encrypted workspace v2.0 wire constants; no v1 or candidate fallback."""

from types import MappingProxyType

CONTRACT_VERSION = "folioview.agent-workspace.v2.0"
PROFILE_ID = "P1"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_JSON_DEPTH = 20
MAX_CONTEXT_BYTES = 16_384
MAX_CONTROL_BYTES = 65_536
MAX_REGISTRY_BYTES = 131_072
MAX_CARRIER_BYTES = 524_288
MAX_HTTP_WRITE_BYTES = 589_824
MAX_STORED_DOCUMENT_BYTES = 786_432
STORAGE_RESERVE_BYTES = 262_144
MAX_MANIFEST_BYTES = 262_144
MAX_READ_BYTES = 1_048_576
MAX_RECIPIENTS = 8
MAX_RESOURCES = 10
MAX_GRANT_SECONDS = 2_592_000
MAX_RUN_SECONDS = 7_200
PRIVATE_BYTE_LIMITS = MappingProxyType(
    {
        "task": 65_536,
        "result_revision": 65_536,
        "holdings_snapshot": 196_608,
        "watchlist_evidence": 196_608,
        "channel_follows_evidence": 196_608,
    }
)
JWE_HEADER = MappingProxyType(
    {"alg": "ECDH-ES+A256KW", "enc": "A256GCM", "typ": "fv-private+jwe", "cty": "application/json"}
)
