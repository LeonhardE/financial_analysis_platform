# Retired Confidential VM release route

The unused standalone Confidential VM release tool and its deployment route have
been retired. Its original design is preserved in Git history. It is not a
prerequisite or supported deployment path for personal Agent-owned credentials.

Use the existing Web, five backend services and storage. Normal existing-service
release rejects retired targets, and first provision cannot select them. No VM,
fixed TCP proxy, separate Policy project or separate Executor project is required.
The general saved-plan and Owner lane mechanisms remain available for supported
targets. This source retirement performs no cloud resource destruction.
