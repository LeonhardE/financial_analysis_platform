# Change records

This directory keeps a small, reviewable record for each material project change.

## Convention

- Add one Markdown file per change.
- Name it `YYYY-MM-DD-short-description.md`.
- If multiple changes share a date and description, add a numeric suffix.
- Describe the user-visible or architectural result, relevant implementation details, and checks
  performed.
- Do not include secrets, credentials, or local environment values.

## Template

```markdown
# Short change title

Date: YYYY-MM-DD

## Summary

Why the change was made and what outcome it provides.

## Changes

- Important change.

## Validation

- Check that was run and its result.
```
