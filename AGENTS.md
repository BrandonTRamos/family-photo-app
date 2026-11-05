# AGENTS.md

## Communication

All messages to the user should be concise. Sacrifice grammar for concision.

## Git

- `main` is what Amplify deploys; every push to it goes live.
- Work on a branch, then fast-forward `main` to it and push. Do this only after the user approves that specific push in chat.
- No pull requests: the user doesn't review them. Never force-push `main`.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.
