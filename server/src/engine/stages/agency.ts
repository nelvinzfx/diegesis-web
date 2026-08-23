/**
 * Agency stage: updates NPC goals and stances based on what they witnessed.
 * Ported from engine/stages/AgencyStage.kt (prompts verbatim).
 */

import type { AiCaller } from '../ai-caller.js';
import { resolvePrompt, type PromptTemplateGetter } from '../prompt-templates.js';
import type { Npc, NpcAgency, Turn } from '../../shared/types.js';
import { asRecord, requireString } from './decode.js';

export const DEFAULT_SYSTEM_PROMPT = `You maintain the inner life of an NPC. Given what THIS NPC has witnessed (below) and their current goal, produce their updated immediate goal and emotional stance.

Reply with JSON only:
{
  "goal": "immediate goal, 1-2 sentences",
  "stance": "emotional stance toward the player, 1 sentence",
  "will_act_on": "what they plan to do next, 1 sentence"
}`;

/**
 * System prompt with template override support. Variables: {{npcName}},
 * {{npcDescription}}, {{personality}}, {{goal}}, {{stance}}, {{willActOn}},
 * {{witnessed}}.
 */
export function resolveSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  npc: Npc,
  witnessedContext: string,
): string {
  return resolvePrompt(getTemplate, 'agency', DEFAULT_SYSTEM_PROMPT, {
    npcName: npc.name,
    npcDescription: npc.description,
    personality: npc.personality,
    goal: npc.agency.goal.length > 0 ? npc.agency.goal : 'none set',
    stance: npc.agency.stance.length > 0 ? npc.agency.stance : 'neutral',
    willActOn: npc.agency.will_act_on.length > 0 ? npc.agency.will_act_on : 'nothing planned',
    witnessed: witnessedContext,
  });
}

export function buildUserPrompt(npc: Npc, witnessedContext: string): string {
  return `## NPC: ${npc.name}
${npc.description}

**Personality:** ${npc.personality}

**Current agency:**
- Goal: ${npc.agency.goal.length > 0 ? npc.agency.goal : 'none set'}
- Stance: ${npc.agency.stance.length > 0 ? npc.agency.stance : 'neutral'}
- Will act on: ${npc.agency.will_act_on.length > 0 ? npc.agency.will_act_on : 'nothing planned'}

## What ${npc.name} witnessed:
${witnessedContext}

Based on these events, update ${npc.name}'s agency. Reply with JSON only.`;
}

interface AgencyUpdate {
  goal: string;
  stance: string;
  will_act_on: string;
}

export function decodeAgencyUpdate(raw: string): AgencyUpdate {
  const obj = asRecord(JSON.parse(raw));
  return {
    goal: requireString(obj, 'goal'),
    stance: requireString(obj, 'stance'),
    will_act_on: requireString(obj, 'will_act_on'),
  };
}

/**
 * Update agency for a single NPC based on their witnessed turns.
 * Returns the updated NpcAgency, or unchanged if generation fails.
 */
export async function updateNpcAgency(
  aiCaller: AiCaller,
  npc: Npc,
  witnessedTurns: Turn[],
  getTemplate?: PromptTemplateGetter | null,
): Promise<NpcAgency> {
  const witnessedContext = buildWitnessedContext(witnessedTurns);

  // Keep current agency if update fails.
  const fallback: AgencyUpdate = {
    goal: npc.agency.goal,
    stance: npc.agency.stance,
    will_act_on: npc.agency.will_act_on,
  };

  const update = await aiCaller.generateStructured(
    resolveSystemPrompt(getTemplate, npc, witnessedContext),
    buildUserPrompt(npc, witnessedContext),
    decodeAgencyUpdate,
    fallback,
  );

  return { goal: update.goal, stance: update.stance, will_act_on: update.will_act_on };
}

/** Build a summary of witnessed turns for the prompt. */
function buildWitnessedContext(witnessedTurns: Turn[]): string {
  if (witnessedTurns.length === 0) return 'Nothing yet.';
  return witnessedTurns
    .map((turn) => {
      const variant = turn.variants[turn.variants.length - 1];
      if (variant) {
        return `**Player:** ${turn.playerInput}\n${variant.synopsis}`;
      }
      return `**Player:** ${turn.playerInput}`;
    })
    .join('\n\n');
}
