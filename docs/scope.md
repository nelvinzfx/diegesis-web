# Diegesis web scope (v1)

## Goal

A playable single-player AI campaign loop in the browser: create a
campaign, get a session plan, play turns through the five-stage
pipeline, with NPCs that have agency, memory, and no omniscience.

## In scope (v1)

- BYOK settings (server-side): OpenAI-compatible (chat completions)
  and Anthropic providers. Per-stage model override (think stages vs
  scene stage).
- Campaign management: create (premise -> generated session plan,
  editable), list, edit, resume, delete.
- Story screen: markdown prose, player input, streaming output with
  thinking/reasoning display and stage-event transparency (which
  pipeline stage is running), stop, regenerate with swipe variants,
  edit+resend, delete turn.
- Full pipeline: router, mechanics (card deck), plot, scene, agency
  updates, memory extraction, forced top-k memory retrieval.
- NPC management: manual creation/edit + character card import
  (V2 JSON file or PNG with embedded `chara` tEXt chunk).
- Scene membership persistence + visibility-filtered context assembly
  (the core invariant, see architecture.md).
- Memories screen: browse extracted facts per campaign/NPC.
- Settings: BYOK providers, prompt template editor.
- Plain JSON/JSONL file storage under `data/`, formats identical to
  the Android app (see storage.md).

## v1 simplifications (deliberate)

- Memory retrieval = forced top-k injection only. Tool-call search
  comes later.
- Trackers are a free-form string->number map updated by the plot
  stage, not a typed system.
- One deck: standard 52 cards, fixed difficulty table (pipeline.md).
- Single player persona (free text in campaign settings).

## Non-goals (v1)

- Light theme (dark-only by design, see ui-theme.md).
- Multiplayer / shared sessions. Accounts or auth (single user, local).
- Google/AICore/Vertex providers. OpenAI Responses API.
- Sync, backup, export beyond raw file access. TTS/STT. Image
  input/output. MCP.
- In-app subagents. Plugin systems.
- Mobile-native packaging (PWA polish is fine; native shells are not).
- i18n (English UI only).
