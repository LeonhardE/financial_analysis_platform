# Keep task reads independent and recoverable

Date: 2026-11-13

## Summary

Tasks appear as soon as their list loads, even when resource discovery is slow or unavailable.
Read failures stay beside the affected content with a local retry instead of a page-wide error.

## Changes

- Preserve previous task/catalogue metadata, show separate accessible loading indicators and
  prevent stale resource selections. Cancel superseded reads and reject late owner/session replies.
- Bound these reads and a single safe pre-forward admission retry to 11.5 seconds. Keep the Web
  proxy's 12-second limit and existing write deadlines, signed packets and acknowledgement recovery.
- Distinguish cancellation, timeout, admission, downstream/network and permission failures with
  fixed localized messages. Expire brief non-actionable feedback and clear it on refresh/reentry.
- Add a Web-controlled deadline header for GET failures without changing the existing error DTO;
  downstream responses cannot forge deadline or safe-retry markers.

## Validation

- Controller/UI/proxy tests cover independent reads, preserved content, stream timeouts, the
  unchanged 12-second proxy deadline with late Hub success, bounded retries, cancellation,
  stale callbacks, owner changes and no automatic write retries.
- Root `npm run check` runs through the normal pre-commit hook; production Web build is checked.
- No storage/contract migration, infrastructure additions or production business validation.
