# AGENTS.md

This file (`AGENTS.md`) is the source of truth; `CLAUDE.md` only imports it, so edit this file, not that one.

## Communication

All messages to the user should be concise. Sacrifice grammar for concision.

## Git

- `main` is what Amplify deploys; every push to it goes live.
- Work on a branch, then fast-forward `main` to it and push. Do this only after the user approves that specific push in chat.
- Never force-push `main`.
- Whenever opening a PR that includes infrastructure changes, tell the user what infrastructure is being added and its cost implications, including any uncertainty in cost estimates.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.
