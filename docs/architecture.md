# Diegesis web architecture

Doc map: [scope](scope.md) · [pipeline](pipeline.md) ·
[storage](storage.md) · [ui-theme](ui-theme.md) · [workflow](workflow.md)

## Monorepo layout

npm workspaces, root `package.json` with `"workspaces": ["server", "web"]`.

```
diegesis-web/
  package.json        root scripts: dev, build, test, typecheck
  server/             node + express + typescript; pipeline host + storage
    src/index.ts      entrypoint (tsx watch in dev)
  web/                vite + react + typescript + HeroUI + tailwindcss SPA
  docs/               this documentation
  data/               runtime storage (gitignored), created by the server
```

## Client/server split

- The SPA (`web/`) talks **only** to our backend. It never talks to AI
  providers directly.
- Provider API keys live only in `server/.env` (BYOK entered through
  settings is persisted server-side). Keys never reach the browser;
  no key ever ships in a bundle or an API response.
- All model traffic (OpenAI-compatible chat completions + Anthropic)
  happens inside `server/`.

## Streaming

The story screen streams three kinds of events from the server over
**SSE** (`text/event-stream`, one endpoint per turn):

- token deltas for scene prose,
- reasoning/thinking summaries while think stages run,
- stage lifecycle events (`stage:start`, `stage:end` with stage name:
  router / mechanics / plot / agency / memory / scene) so the UI can
  show pipeline transparency without polling.

SSE is chosen over WebSockets because turns are one-directional after
the request and it survives proxies better. The player's input itself
is a plain POST.

## Dev proxy

`web/vite.config.ts` proxies `/api/*` to `http://localhost:8920`
(`changeOrigin: true`) so the vite dev server and the express server
share an origin in development — no CORS needed. In production the
express server serves `web/dist` as static files and falls back to
`index.html` for non-API GETs (SPA routing).

## Ports

- Server: `8920` default (`PORT` env overrides).
- Web dev server: `8921`.
- (8001 is occupied by SillyTavern on the reference device.)

## Data model

Same documents as the Android app; see [storage.md](storage.md).

### Core invariant: visibility filter

The scene stage's context contains ONLY:

1. the fresh synopsis from the plot stage,
2. sheets/agency/trackers of NPCs in `presentNpcIds`,
3. narration from past turns where at least one currently present NPC
   was also present.

Player secrets and off-screen events never enter the scene prompt.
Enforced by the assembler in code, not by instructions.

## Stage contracts

- **Router** in: playerInput, sceneState, flags. out:
  `{ needs_check, checks[], run_agency_update, lore_query }`.
- **Mechanics**: pure code. Card deck draw + modifiers -> outcome
  objects injected into plot input verbatim. Never model-decided.
- **Plot** in: sessionPlan, recent summary, mechanicResults, memories.
  out: `{ synopsis, present_npcs, scene_change, location?, tracker_updates[] }`.
- **Agency** per affected NPC: witnessed-turns-only input ->
  `{ goal, stance, will_act_on }`.
- **Scene** in: synopsis, visibility-filtered context, NPC payloads.
  out: prose (markdown). Only stage text that reaches the story screen.
- **Memory**: extraction pass over the finished turn ->
  `memories.jsonl`; retrieval via forced top-k injection pre-turn.

## Regenerate / swipe

A turn's `variants[]` keeps full stage outputs per variant. Regenerate
re-runs the pipeline from that turn's playerInput and appends a new
variant. Deleting a turn truncates later turns (state is derived).
