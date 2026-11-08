# Offline bootstrap deployment fixtures

`deployment-configs.json` maps target names to canonical target-instance JSON
strings, matching the trigger substitution transport. The repo, Market, User,
Config, Web and Portfolio projections satisfy the shared runtime's closed
schema and fit its 4000-byte budget. Web's three API origins use synthetic fixture identifiers;
its Firebase authentication fields are all empty.

These fixtures use a fictitious project and project number, synthetic UID/image/trigger
identifiers and role-based account names so provider-mocked bootstrap can verify ownership
relationships without publishing an operator's deployment. Source-bound trust digests are
recomputed from the same synthetic inputs.
They are not operator inventory, trusted live evidence, production defaults or
activation requests. Only targets whose catalog explicitly says `trigger-v1`
consume their fixture; merely including a projection cannot migrate or enable
another target. Do not copy these values into an operator deployment profile.

`portfolio-trust.json` extends only the existing synthetic Portfolio projection
with a mock Hub anchor, pinned numeric subject and selected Web runtime. It is
generated from committed test inputs, contains no private deployment inputs, and
exercises exact service invokers independently from image-release activation.
