"""Bound concurrency for independent localhost compatibility scenarios."""

from concurrent.futures import ThreadPoolExecutor


def run_scenarios(cases, jobs=1):
    if type(jobs) is not int or not 1 <= jobs <= 8:
        raise ValueError("Scenario workers must be between 1 and 8")
    # Each callback owns its temporary root, state and HTTP fixture. The provider
    # mirror is read-only; there is no concurrently written plugin cache.
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(lambda case: case(), cases))
