# @wiseiodev/guardrails

Agent-friendly guardrails for JS/TS pnpm repositories.

This first slice installs the core hygiene layer:

- Biome formatting and linting
- Lefthook pre-commit, commit-msg, and pre-push hooks
- Commitlint with one required tracker reference
- Runtime pins and package scripts
- GitHub checks workflow
- Pull request template
- AGENTS.md guardrails block and symlinks for Claude/Copilot
- Deterministic `plan`, `apply`, and `doctor` output

## Commands

```bash
pnpm add -D @wiseiodev/guardrails
pnpm guardrails init
pnpm guardrails plan --json
pnpm guardrails apply --yes
pnpm guardrails doctor --json
```

`apply` never mutates unless `--yes` is present. Remote GitHub changes are
planned, but this first implementation only applies local repository files.

## Tracker Presets

V1 includes presets for Linear, GitHub Issues, Jira, and Azure Boards. The
generated commitlint rule requires exactly one configured work-item reference in
each commit message.
