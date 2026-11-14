"""Snapshot boundary for existing lightweight storage parser tests."""

from copy import deepcopy
from types import SimpleNamespace


def install_batch_reads(client):
    def get_all(references, **_options):
        snapshots = []
        for reference in references:
            effect = reference.get.side_effect
            if effect is not None:
                if isinstance(effect, BaseException):
                    raise effect
                effect()
            value = deepcopy(reference.get.return_value.to_dict.return_value)
            snapshots.append(
                SimpleNamespace(
                    reference=reference,
                    exists=value is not None,
                    to_dict=lambda value=value: deepcopy(value),
                )
            )
        return iter(snapshots)

    client.get_all.side_effect = get_all
