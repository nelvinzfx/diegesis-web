/**
 * Router stage: decides if mechanics checks are needed.
 * Ported from engine/stages/RouterStage.kt (prompts verbatim).
 */

import type { AiCaller } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import type { MechanicCheck, RouterDecision, SceneState } from '../../shared/types.js';
import { arrayOrEmpty, boolOrDefault, intOrDefault, asRecord, requireString } from './decode.js';

export const DEFAULT_SYSTEM_PROMPT = `You are the router for a tabletop RPG turn. Decide if the player's action requires a mechanics check.

Reply with JSON only:
{
  "needs_check": false,
  "checks": [{"skill": "string", "dc": 5, "modifier": 0, "advantage": 0}],
  "run_agency_update": false,
  "lore_query": null
}

- needs_check: true if any mechanics roll is needed
- checks: array of checks (dc 3-18, advantage -1/0/1 for disadvantage/normal/advantage)
- run_agency_update: true if NPCs should update their goals after this turn
- lore_query: reserved for future memory search`;

export function buildUserPrompt(playerInput: string, sceneState: SceneState): string {
  const location = sceneState.location.length > 0 ? sceneState.location : 'unspecified';
  const npcs = sceneState.presentNpcIds.length > 0 ? sceneState.presentNpcIds.join(', ') : 'none';
  return `Scene state:
- Location: ${location}
- Present NPCs: ${npcs}

Player action: ${playerInput}

Does this require a check? Reply with JSON only.`;
}

export const routerFallback: RouterDecision = {
  needs_check: false,
  checks: [],
  run_agency_update: false,
  lore_query: null,
};

export function decodeRouterDecision(raw: string): RouterDecision {
  const obj = asRecord(JSON.parse(raw));
  const checks: MechanicCheck[] = arrayOrEmpty(obj, 'checks').map((entry) => {
    const checkObj = asRecord(entry);
    return {
      skill: requireString(checkObj, 'skill'),
      dc: intOrDefault(checkObj, 'dc', 5),
      modifier: intOrDefault(checkObj, 'modifier', 0),
      advantage: intOrDefault(checkObj, 'advantage', 0),
    };
  });
  let loreQuery: string | null = null;
  const lore = obj['lore_query'];
  if (typeof lore === 'string') loreQuery = lore;
  return {
    needs_check: boolOrDefault(obj, 'needs_check', false),
    checks,
    run_agency_update: boolOrDefault(obj, 'run_agency_update', false),
    lore_query: loreQuery,
  };
}

/**
 * System prompt with template override support. Variables: {{playerInput}},
 * {{location}}, {{presentNpcs}}.
 */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  playerInput: string,
  sceneState: SceneState,
): string {
  const location = sceneState.location.length > 0 ? sceneState.location : 'unspecified';
  const npcs = sceneState.presentNpcIds.length > 0 ? sceneState.presentNpcIds.join(', ') : 'none';
  return resolvePrompt(getTemplate, 'router', DEFAULT_SYSTEM_PROMPT, {
    playerInput,
    location,
    presentNpcs: npcs,
  });
}

export async function execute(
  aiCaller: AiCaller,
  playerInput: string,
  sceneState: SceneState,
  getTemplate?: PromptTemplateGetter | null,
): Promise<RouterDecision> {
  return aiCaller.generateStructured(
    resolveSystemPrompt(getTemplate, playerInput, sceneState),
    buildUserPrompt(playerInput, sceneState),
    decodeRouterDecision,
    routerFallback,
  );
}
