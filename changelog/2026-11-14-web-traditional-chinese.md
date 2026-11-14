# Add Traditional Chinese interface language

Date: 2026-11-14

## Summary

Settings now offers 繁體中文 alongside English and 简体中文, with a complete Traditional Chinese
catalog and account-persisted selection through the independently released Config language endpoint.

## Changes

- Add all 1635 Traditional Chinese messages, document language/title, locale formatting and the
  native language option. Existing Chinese task-report defaults retain their frozen `zh` contract.
- Read the optional versioned language namespace; inherit the existing v1 language when absent.
  Save Traditional choices and subsequent language changes through the exact Config language route.
- Preserve the legacy v1 enum/body, guest memory behavior, account isolation, unknown-save recovery,
  strict request/response bounds and the existing first-paint theme behavior.
- Cover the real language store through the authenticated request boundary, reload restoration,
  CAS/unknown outcomes, guest adoption, owner changes, all three catalogs and native controls.

## Validation

- 107 focused preference, language, authentication, Settings and ICU checks passed.
- TypeScript and production Web build passed. Local guest preview visibly switched to 繁體中文
  with `lang=zh-Hant`, Traditional title and translated Settings/navigation controls.
- Full root `npm run check` is enforced by the pre-commit gate. No production account preference
  was changed for local preview.
