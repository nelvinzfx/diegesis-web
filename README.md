# Diegesis Web

Diegesis is a GM/campaign narrative engine for tabletop-style roleplay:
a multi-stage AI pipeline (router / deck mechanics -> plot planning ->
NPC agency -> scene writing -> memory extraction) with a hard
**visibility invariant** — the scene stage only ever sees what the
player character has witnessed. No omniscient NPCs.

This is the **web** version. The engine concept and pipeline are ported
from the `nelvinzfx/diegesis` Android project (same author); on-disk
data formats stay identical so campaigns are conceptually portable.

## Monorepo layout

```
server/   node + express + typescript (API, pipeline host, storage) 
web/      vite + react + typescript + HeroUI + tailwindcss (SPA)
docs/     architecture, scope, pipeline, storage, ui-theme, workflow
```

The browser talks only to our backend. AI provider keys live in
`server/.env` and never reach the client.

## Features

Multi-stage pipeline (router / deck mechanics / plot / NPC agency / scene /
memory extraction), visibility-filtered context, streaming prose with
reasoning taps, NPC manager with character-card import (JSON / PNG),
memory browser, session planning, auto titles, per-stage prompt template
overrides with a live exact-request preview, BYOK settings (OpenAI-compatible
+ Anthropic).

## Quickstart

```bash
npm install          # installs both workspaces
cp server/.env.example server/.env   # optional bootstrap: OPENAI_BASE_URL,
                                     # OPENAI_API_KEY, ANTHROPIC_API_KEY, PORT
npm run dev          # server on :8920, web on :8921 (vite proxies /api)
```

Open http://localhost:8921. Health check: http://localhost:8920/api/health

Keys can also be entered later in Settings (stored in `server/data/settings.json`,
never sent to the browser). Prompt templates are editable in the Prompts view;
overrides live in `server/data/prompt-templates.json`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (`tsx watch`) + web (`vite`) concurrently |
| `npm run build` | typechecks/builds server, builds web into `web/dist` |
| `npm run test` | vitest suite in `server/` |
| `npm run typecheck` | `tsc --noEmit` in both workspaces |

Server default port is `8920` (8001 is taken by SillyTavern on this
device).

## Docs

Start with [docs/architecture.md](docs/architecture.md), then
[scope.md](docs/scope.md), [pipeline.md](docs/pipeline.md),
[storage.md](docs/storage.md), [ui-theme.md](docs/ui-theme.md),
[workflow.md](docs/workflow.md).

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
