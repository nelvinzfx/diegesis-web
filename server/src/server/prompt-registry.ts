/**
 * Prompt stage registry: the metadata behind GET /api/prompt-templates and
 * the Prompts page. Defaults are imported from the modules that ship them so
 * this list can never drift from what the engine actually sends.
 */

import * as RouterStage from '../engine/stages/router.js';
import * as PlotStage from '../engine/stages/plot.js';
import * as AgencyStage from '../engine/stages/agency.js';
import { DEFAULT_NARRATOR_VOICE } from '../engine/stages/scene.js';
import * as MemoryExtractionStage from '../engine/stages/memory-extraction.js';
import * as TrackerUpdateStage from '../engine/stages/tracker-update.js';
import { DEFAULT_TITLE_SYSTEM } from './title-service.js';
import { DEFAULT_PLAN_SYSTEM_PROMPT } from '../routes/plan.js';
import { DEFAULT_OPENING_SYSTEM_PROMPT } from '../routes/opening.js';
import { STAGE_KEYS, STAGE_VARIABLES, type StageKey } from '../engine/prompt-templates.js';

export interface PromptStageInfo {
  key: StageKey;
  label: string;
  description: string;
  variables: readonly string[];
  default: string;
}

export const PROMPT_STAGES: PromptStageInfo[] = [
  {
    key: 'router',
    label: 'Router',
    description:
      'Decides whether the player action needs a mechanics check. Reply is parsed as JSON.',
    variables: STAGE_VARIABLES.router,
    default: RouterStage.DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'plot',
    label: 'Plot',
    description:
      'Plans the beat: synopsis, present NPCs, tracker deltas. Reply is parsed as JSON.',
    variables: STAGE_VARIABLES.plot,
    default: PlotStage.DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'agency',
    label: 'Agency',
    description:
      'Updates one NPC goal and stance from what they witnessed. Runs per present NPC.',
    variables: STAGE_VARIABLES.agency,
    default: AgencyStage.DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'scene',
    label: 'Scene',
    description:
      'The narrator voice that writes the prose you read. Overrides replace it entirely.',
    variables: STAGE_VARIABLES.scene,
    default: DEFAULT_NARRATOR_VOICE,
  },
  {
    key: 'memory-extraction',
    label: 'Memory extraction',
    description:
      'Pulls durable facts out of a finished turn. Reply is parsed as a JSON array.',
    variables: STAGE_VARIABLES['memory-extraction'],
    default: MemoryExtractionStage.DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'tracker-update',
    label: 'Status board',
    description:
      'Rewrites the live status board after each turn: time, place, atmosphere, looks, and NPC inner voices. Reply is parsed as JSON.',
    variables: STAGE_VARIABLES['tracker-update'],
    default: TrackerUpdateStage.DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'session-plan',
    label: 'Session plan',
    description: 'Drafts the session arc shown on the campaign page.',
    variables: STAGE_VARIABLES['session-plan'],
    default: DEFAULT_PLAN_SYSTEM_PROMPT,
  },
  {
    key: 'title',
    label: 'Auto title',
    description: 'Names an untitled campaign after the first completed turn.',
    variables: STAGE_VARIABLES.title,
    default: DEFAULT_TITLE_SYSTEM,
  },
  {
    key: 'opening',
    label: 'Opening scene',
    description:
      'Drafts the first message shown when the story starts. Streams via the opening generator on the campaign page.',
    variables: STAGE_VARIABLES.opening,
    default: DEFAULT_OPENING_SYSTEM_PROMPT,
  },
];

export function findStage(key: string): PromptStageInfo | null {
  return PROMPT_STAGES.find((stage) => stage.key === key) ?? null;
}

export function isRegisteredStage(key: string): key is StageKey {
  return (STAGE_KEYS as readonly string[]).includes(key);
}
