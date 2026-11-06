# Preserve the workspace during navigation after a deployment

Date: 2026-11-06

## Summary

Switching workspace views no longer requests a new server-rendered route. An open page can
therefore keep its in-memory owner session when the server has deployed a different build.
The Next.js server-navigation build-ID fallback can otherwise reload the entire document and
lose that session.

## Changes

- Use Next.js-supported native history updates for the workspace's already mounted views and
  same-workspace Agent/Inbox link routing. Sidebar and home links are native anchors without
  server-route prefetching. First-load handoffs wait for the parent router history
  integration before changing their URL. Keep independent URLs, direct loading, browser
  back/forward behavior, and real anchor links for opening another tab.
- Retain the existing owner, lock, logout and permission checks. No keys are persisted, exported
  or shared between documents, and an explicit reload still creates a new memory session.
- Exercise view changes with server-navigation methods unavailable, preserving the shared
  workspace identity, task drafts and link behavior.

## Validation

- Sixteen targeted workspace/session/full-flow tests and Web type checking pass.
- Native Chrome verification uses the real production-built Next app with server workspace
  navigation denied, checking view changes and back/forward preserve a public client draft.
- Production Web build and root `npm run check` pass.

Reference: [Next.js native History API](https://nextjs.org/docs/app/guides/single-page-applications).
