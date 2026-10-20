# Repository Instructions

## Commit conventions

- Use `Xianxin <zxx9808181@gmail.com>` as the author for every commit.
- Credit Codex as a collaborator by adding `Co-authored-by: Codex <codex@openai.com>` to every commit message.
- Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for every commit message.

## Change workflow

- Add one Markdown change record under `changelog/` for every material change, except changes
  confined to `local-docs/`.
- Creating, updating, or deleting local-only documentation in `local-docs/` does not require a
  changelog entry. For a mixed change, record only the material changes outside `local-docs/`.
- Follow the naming and content convention in `changelog/README.md`.
- Run `npm run check` from the repository root before committing.
