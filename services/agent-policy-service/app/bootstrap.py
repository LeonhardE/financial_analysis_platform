"""Explicit offline Root-authorized initialization; never invoked during recovery."""

import argparse
import json
from pathlib import Path

from folioview_shared.encrypted.jsonutil import strict_json_loads

from .attestation import GoogleAttestation
from .config import Config
from .policy import Policy
from .signing import KMS
from .store import SQLiteWitness, configured_store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root-command", required=True)
    args = parser.parse_args()
    config = Config.environment()
    store = configured_store(config)
    if isinstance(store.witness, SQLiteWitness):
        store.witness.initialize_storage()
    signed = strict_json_loads(Path(args.root_command).read_bytes(), max_bytes=32768)
    Policy(config, store, KMS(config), GoogleAttestation()).bootstrap(signed)
    print(json.dumps({"initialized": True, "domain": config.domain, "productionActivated": False}))


if __name__ == "__main__":
    main()
