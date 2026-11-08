# Runtime restoration after navigation

Date: 2026-11-07

## Summary

Moving an existing runtime page from first pairing to its resume URL changed only the fragment.
The document kept its old Worker and pairing state, so the page could appear prepared without
having initialized the requested identity. It now reloads the current descriptor safely.

## Changes

- Reload once on runtime fragment navigation and on a restored back/forward-cache document.
- Clear the old private view and ignore late responses before reloading; retain existing keys,
  Root permissions and original encrypted outboxes.
- Tell native clients to reuse the original protected window/tab and profile rather than assume
  that another window retains the same key storage.
- Rebuild the checked page bundle and manifest. Cryptographic Worker bytes remain unchanged.

## Validation

- Twelve DOM regressions, including descriptor changes, BFCache restoration and late responses.
- Real Chrome synthetic reproduction: pairing state stayed stale before the fix; the same-tab
  transition now initializes the resume state without a new connection.
- Complete repository checks run before the signed commit; GitHub checks precede merge.
- Cross-window, protected-host restart and cross-day key continuity remain separate real-host
  acceptance requirements. This change does not claim those have passed.
