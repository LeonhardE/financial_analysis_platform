# Passkey guidance, recovery checks and device management

Date: 2026-10-30

## Summary

Let owners review their encrypted library's device keys, explicitly authorize a new browser,
rotate or revoke operational device keys, and check the original Passkey's recovery capability.
All operations reuse existing public registry and encryption contracts.

## Changes

- Prefer local Passkey creation, require explicit alternate-device selection and explain Bluetooth
  proximity before phone use. Cancel and erase late PRF results without automatic fallback.
- Add bilingual Settings management with verified fingerprints, device/recovery validity, explicit
  review and truthful distinctions between login, unlock, device authorization and recovery.
- Pause new-browser enrollment for approval and support explicit new device identities after old
  keys were revoked. Never revive old key IDs or silently update agent grant recipients.
- Persist original signed registry operations and sealed candidate keys. Reconcile uncertain
  commits, preserve candidates until a safe outcome is known, and fence cross-tab promotion and
  concurrent enrollment against key loss.
- Verify the original archive and root/recovery key use in a short-lived Worker without key
  export, server-side decryption, new routes, shared formats or cloud configuration.
- Keep unsupported lost-Passkey recovery, protecting-Passkey replacement, archive reset and full
  root/recovery renewal explicit; this is a bounded WEB-010 delivery, not the whole lifecycle.

## Validation

- Complete root `npm run check` passes: 458 Web tests pass with no skips, including actual
  Python VaultService interoperability; existing API, infrastructure and CI suites pass.
- Production Web build passes. Anonymous desktop/mobile checks confirm the Settings entry,
  recovery limitations, English/Chinese, dark/light, keyboard navigation and no horizontal overflow.
- Synthetic tests cover device changes, original-operation recovery, concurrent storage fences,
  explicit enrollment, Passkey cancellation and lock/logout/account-switch isolation. They do not
  replace physical Passkey or authenticated production recovery acceptance.
