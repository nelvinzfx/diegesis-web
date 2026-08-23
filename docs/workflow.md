# Workflow

## Termux gotchas

- npm bin shims (`node_modules/.bin/*`) fail: shebangs use `/usr/bin/env`, which does not exist here. Run tools by their JS entrypoints instead: `node ../node_modules/tsx/dist/cli.mjs`, `node ../node_modules/vite/bin/vite.js`, `node ../node_modules/vitest/vitest.mjs run`.
- Plain `node server/src/index.ts` fails on `.js` extension imports (native type stripping resolves literally). Always run the server through tsx.
- `/tmp` is read-only; use `$TMPDIR`.
- `pgrep -f`/`pkill -f` with a pattern that matches the wrapper shell itself corrupts tool output. Kill servers by PID file (`nohup ... & echo $! > $TMPDIR/x.pid`).

## Roles

- **Owner**: product decisions, runtime testing, phase-gate approval.
  Nothing moves to the next phase without owner sign-off.
- **Coordinator (lira)**: review, git handling (workers NEVER run git
  commands), releases, cross-worker arbitration.
- **Workers**: implement within their phase scope, verify locally,
  report honestly (quote real command output; never claim unrun
  verification).

## Phase plan

| Phase | Scope | Gate |
|---|---|---|
| 0 | Docs + monorepo scaffold + theme tokens + health endpoint + hello screen | owner approval |
| 1 | Engine port (pipeline stages as pure TS modules) + unit tests | owner approval |
| 2 | API routes + storage layer (atomic writes, formats per storage.md) | owner approval |
| 3 | Story screen: streaming, thinking display, stage events, swipe variants | owner approval |
| 4 | Campaigns, NPCs (+ character card import), settings BYOK, memories screens | owner approval |
| 5 | Polish + prompt template editor | owner approval |

Rules:

- Stay strictly inside your phase's scope. Out-of-scope ideas go into
  notes, not commits.
- Workers verify locally before reporting: typecheck, tests, boot +
  curl, build. Quote outputs.
- No secrets in any tracked file; `.env` is gitignored, ship
  `.env.example` only.
- Coordinator runs all git operations; workers describe what changed.
