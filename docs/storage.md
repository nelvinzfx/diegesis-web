# Storage specification

Ported from the Android app. File formats are IDENTICAL so campaign
data is conceptually portable between the two apps (copy the
campaign folder, adjust nothing).

Plain JSON/JSONL under `data/` in the repo root (server cwd). No ORM,
no database.

## Layout

```
data/
  settings.json                 BYOK providers, stage model overrides
  campaigns/
    <campaignId>/
      campaign.json             meta + sessionPlan + sceneState
      npcs/<npcId>.json         sheet + agency + voice + trackers
      turns/<index>.json        one file per turn, zero-padded index
      memories.jsonl            append-only extraction output
```

## Formats

`campaign.json`
```json
{
  "id": "uuid",
  "title": "string",
  "premise": "string",
  "sessionPlan": "string (markdown)",
  "playerPersona": "string",
  "sceneState": { "location": "string", "presentNpcIds": ["uuid"] },
  "thinkModel": { "provider": "openai-compat", "model": "id" },
  "writeModel": { "provider": "anthropic", "model": "id" },
  "createdAt": "epoch ms",
  "updatedAt": "epoch ms"
}
```

`npcs/<npcId>.json`
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "personality": "string",
  "voiceExamples": ["string"],
  "agency": { "goal": "...", "stance": "...", "will_act_on": "..." },
  "trackers": { "trust": 0, "coin": 12 },
  "sourceCard": null
}
```

`turns/<index>.json` — Turn document: index, playerInput,
routerDecision, presentNpcIds, mechanicResults, createdAt.
Variants live in `variants[]`; each variant keeps synopsis,
sceneOutput, checks, interrupted flag, timestamp.

`memories.jsonl` — one JSON object per line:
`{ "scope": "campaign"|"npc", "npc_id": null, "fact": "..." , "turn": 12, "ts": 0 }`

## Write rules

- Every write is atomic: write `<file>.tmp`, then rename over the
  target. Never write in place.
- JSONL appends go through a single-writer mutex per campaign.
- Pretty-printed JSON (2 spaces) so files stay human-readable and
  hand-editable. This is a feature.
- Turn files are immutable once written, except `variants[]` growth.
- Deletes: delete turn N truncates turns > N (state is derived).

## Character card import

- Accept `.json` (spec_v2 `data` object) and `.png` (read `chara`
  tEXt chunk, base64 -> JSON).
- Map: name->name, description->description, personality->personality,
  mes_example->voiceExamples, first_mes ignored (GM context),
  scenario appended to description.
- Original card JSON kept in `sourceCard` for re-import.
