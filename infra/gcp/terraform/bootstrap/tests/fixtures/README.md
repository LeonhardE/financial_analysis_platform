# Offline bootstrap deployment fixtures

`deployment-configs.json` maps target names to canonical target-instance JSON
strings, matching the trigger substitution transport. The repo, Market, User,
Config, Web and Portfolio projections satisfy the shared runtime's closed
schema and fit its 4000-byte budget. Web's three API origins use the legacy public fixture identifiers;
its Firebase authentication fields are all empty.

These fixtures deliberately retain the legacy test project, existing runtime
account names, public UID/image/build-trigger examples and synthetic execution
trigger UUIDs so the provider-mocked bootstrap can verify unchanged ownership.
They are not operator inventory, trusted live evidence, production defaults or
activation requests. Only targets whose catalog explicitly says `trigger-v1`
consume their fixture; merely including a projection cannot migrate or enable
another target. Do not copy these values into an operator deployment profile.
