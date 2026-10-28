"""Isolate temporary Git repositories from hook-local repository and config state."""

import os
from collections.abc import Mapping


def isolated_git_environment(environment: Mapping[str, str] | None = None) -> dict[str, str]:
    """Keep normal process settings, but never inherit a parent hook's Git context.

    GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG_COUNT/PARAMETERS and future
    Git options can redirect commands into the caller's repository. Fixtures and
    read-only scanning must discover their explicitly selected cwd instead.
    """
    result = {
        key: value
        for key, value in (os.environ if environment is None else environment).items()
        if not key.startswith("GIT_")
    }
    result.update(
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_TERMINAL_PROMPT="0",
    )
    return result
