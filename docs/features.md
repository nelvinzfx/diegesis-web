# Feature catalog

Everything diegesis-web does today, and every field a character/campaign
needs. Single source of truth for writing content without reading code.

## Data model

**Campaign**
- `title` (auto-generated from the first turn when left "Untitled", hard-capped 40 chars, word-boundary cut), `premise`, `sessionPlan`, `playerPersona`, `openingMessage`
- `sceneState { location, presentNpcIds }` — presence is BY NPC ID; plot-written names are resolved to ids at turn time (id -> case-insensitive name -> containment, unresolvable dropped with a stage event)
- `trackerState` — the live status board (below)
- `thinkModel` / `writeModel` — optional per-campaign `{provider, model}` overrides; global settings win when null

**Npc**
- `name`, `description`, `personality`
- `firstMessage` — used as the opening scene when this NPC leads (imported from V2 card `first_mes`)
- `voiceExamples` — dialogue style references (imported from `mes_example`, split on `<START>` / `{{char}}:` / `{{user}}:`)
- `agency { goal, stance, will_act_on }` — what the NPC wants right now
- `trackers` — numeric key-value stats (e.g. trust: 3), updated by memory-extraction (name-resolved to id)
- `sourceCard` — embedded PNG when imported from a card file

**Turn / TurnVariant** — a turn = playerInput + variants[]. Turn 0 = the opening (playerInput ""). Variant carries: `synopsis`, `sceneOutput`, `routerDecision`, `presentNpcIds` (recorded at play time), `mechanicResults`, `interrupted`, `stageEvents`, `reasoning` (persisted thinking), `tension` ("escalate" | "hold" | "release", null on old data).

**Memory** — `scope` ("campaign" or npc), `text`, turn ref. Extracted automatically each turn; visible + deletable in the Memories page.

**Settings (flat, global)** — `provider`: "openai-compat" | "anthropic" (ONE choice); `thinkModel` + `writeModel` (plain model-id strings); `openaiBaseUrl` (only used for openai-compat); `openaiApiKey` / `anthropicApiKey`; `language` (story language, free text — narration follows it, dialogue follows each character's background); `thinkingEffort` low/medium/high/xhigh; `writeMaxTokens`; `contextWindowTokens`.

## The pipeline (per turn)

router (52-card deck mechanics: advantage/disadvantage, tiers vs DC) -> plot (omniscient planner: synopsis, present_npcs, scene_change, tracker_updates, tension) -> agency (NPC goals, conditional) -> scene (visibility-bound streaming prose) -> memory-extraction -> tracker-update.

Invariants:
- **Visibility**: the scene stage only sees what the player character witnessed. Everything else is filtered out before assembly.
- **Context trimming**: chars/4 estimate, budget (contextWindowTokens - writeMaxTokens) * 0.8, oldest visible turns dropped first, stage event recorded.
- **Contract vs template**: JSON output contracts live in code-built prompt parts; template overrides can change guidance but can never break parsing. Garbage output -> fence sanitize -> one retry -> fallback + stage event.
- **Tracker**: full-state rewrite each turn (self-healing); failure keeps the previous board. innerVoice is honest — the board is a READER affordance; the visibility invariant governs narration only.
- **Auto title**: first completed turn of an untitled campaign names it via one cheap think call (sanitized, capped).
- **Tension**: plot judges escalate/hold/release; last 5 turns of history feed the next plot call; scene gets "Beat pacing". Release beats are quiet by design.

## Prompt templates (9 keys, all overridable in the Prompts page)

`router` (playerInput, location, presentNpcs) · `plot` (sessionPlan, storySoFar, tensionHistory) · `agency` (npcName, npcDescription, personality, goal, stance, willActOn, witnessed) · `scene` (playerInput, synopsis, location, presentNpcs, tension) · `memory-extraction` (playerInput, synopsis, sceneOutput) · `session-plan` (title, premise, playerPersona) · `title` (maxChars, language, playerInput, synopsis) · `opening` (title, premise, sessionPlan, location, playerPersona, presentNpcs, language) · `tracker-update` (previousTracker, synopsis, sceneOutput, location, presentNpcs, playerPersona, language).

Preview: `GET /api/campaigns/:id/prompt-preview?stage=<key>&playerInput=...` returns the EXACT assembled prompt without calling any AI.

## API surface

`GET /api/health` · settings `GET|PUT` · campaigns `GET|POST|GET:id|PUT:id|DELETE:id` · npcs `GET|POST|PUT|DELETE /api/campaigns/:id/npcs` + `POST .../npcs/import` (body `{json}` or raw PNG bytes) · memories `GET /:id/memories`, `DELETE /:id/memories/:memoryId`, `DELETE /:id/memories` · turns `GET`, `POST` (SSE), `DELETE :index` (truncates from there), `PUT :index` (in-place edit: playerInput and/or variantId+sceneOutput) · `POST /:id/opening` (materialize turn 0), `POST /:id/opening/generate` (SSE) · `POST /:id/plan` (SSE) · prompt-templates `GET|PUT|DELETE` · prompt-preview `GET` · tracker `GET|PUT`.

SSE events: `stage {line}`, `reasoning {text}`, `token {text}`, `done {turn, variant, campaignTitle?, trackerState?}`, `error {message}`.

## Web UI

Three-column director's booth: rail (nav + campaign switcher) / reading column / inspector (idle: selected turn details + status board + tension chip; live: stage progress + reasoning stream + event log).

Turns: action cue (player) + bordered prose (writer); toolbar on hover or tap-to-select (touch): regenerate, edit (inline cue+prose, Save / Save and rerun / Cancel), copy, delete-from-here (confirm). Variant switcher. Streaming: live pipeline block inline (spinner + stages + reasoning, auto-collapses when prose flows). Errors: heroui toasts. Input bar: Enter sends on desktop, newline on touch, Esc stops; IME-composition safe.

Pages: campaign create/edit (plan generation SSE with live reasoning; opening section: editable textarea + AI generate via the `opening` template), NPCs (editor + import .json/.png or paste, present-in-scene chips, firstMessage field), Memories (scope chips, per-item delete, clear all), Settings (provider cards; fields conditional per provider; empty key = keep), Prompts (override editor + live exact-request preview).

## Writing a character card (what the importer accepts)

Character Card V2 JSON (`spec: "chara_card_v2"`, `data` block) or PNG with a `chara` tEXt chunk. Fields used: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`.

Reference asset: `/sdcard/Download/diegesis/lira-card.json` + `campaign-senja-jakarta.txt`.
