# AI-DLC on jcode

The jcode runtime is one of the framework's harness distributions, for the
open-source **jcode** coding agent. One deterministic core, many harnesses: the
engine, state machine, audit log and graph are the same on every distribution,
and only the shell differs. The source/development tree is **generated** into
ignored local `dist/jcode/` from `core/` + `harness/jcode/` by
`bun scripts/package.ts jcode`; never hand-edit it.

## Layout

Everything lives under one `.jcode/` directory, plus the workspace shell
(`aidlc/`) and the shared root files.

- **`.jcode/skills/`**: the `/aidlc` orchestrator skill, the generated stage
  runners and the read-only session skills. jcode ranks `.jcode/` above
  `.agents/` and `.claude/` for a skill of the same name, so a project that
  also has a Claude install still gets this one.
- **`.jcode/agents/`**: the 14 persona files. They are jcode agent definitions,
  so the swarm tool's `agent` property targets them by name.
- **`.jcode/tools/`, `aidlc-common/`, `knowledge/`, `sensors/`, `scopes/`,
  `hooks/`**: the engine tree. jcode does not scan these, so they share the
  directory safely.
- **Root `AGENTS.md`**: jcode reads it into every new session. It is the
  harness-neutral block shared with other installed harnesses. There is no
  `@`-import, so the method reaches a step through the engine's own delivery,
  as on Codex.

## Prerequisites

- **jcode** with project skills and agent definitions (check `jcode --version`).
- **Project trust.** Project hooks and agent policy run only after you trust the
  project: `jcode trust grant`, once per project.
- **bun** only when generating the source/development `dist/` projection.

## Install

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
cd your-project
aidlc config --harness jcode
aidlc doctor
jcode trust grant
jcode
```

Then run `/aidlc --doctor`, and `/aidlc` followed by what you want to build.
Framework developers can run `bun scripts/package.ts jcode` and copy the ignored
`dist/jcode/` output into a scratch project to try a change.

## What's different on this harness

- **Questions render as numbered prose options.** The questions file with
  `[Answer]:` tags stays the source of truth.
- **Hooks come from the project's `[hooks]` table** in `.jcode/config.toml`,
  and run only once the project is trusted.
- **Personas are native agents.** The conductor adopts them inline for most
  stages and can fan out through the swarm tool.

## Verifying an install

```bash
aidlc doctor
```
