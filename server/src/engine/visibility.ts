/**
 * Visibility context assembler — the anti-omniscience invariant.
 *
 * Ported from engine/assembler/VisibilityContextAssembler.kt.
 *
 * THE CORE INVARIANT: a past turn is visible IF AND ONLY IF:
 *  - presentNpcIds is empty (solo player scene), OR
 *  - at least one currently present NPC was also present in that past turn.
 *
 * This prevents the scene stage from accessing information NPCs couldn't have
 * witnessed.
 */

import type { MechanicResult, MemoryEntry, Npc, Turn } from '../shared/types.js';

export interface NpcPayload {
  id: string;
  name: string;
  description: string;
  personality: string;
  voiceExamples: string[];
  agency: string; // formatted goal + stance
  trackers: Record<string, number>;
}

export interface HistoryEntry {
  playerInput: string;
  sceneOutput: string;
}

export interface SceneContext {
  synopsis: string;
  /** This beat's pacing judgment (escalate | hold | release); null = unset. */
  tension: string | null;
  location: string;
  mechanicOutcomes: MechanicResult[];
  presentNpcs: NpcPayload[];
  filteredHistory: HistoryEntry[];
  retrievedMemories: MemoryEntry[];
  playerInput: string;
}

export interface AssembleInput {
  synopsis: string;
  tension: string | null;
  location: string;
  mechanicResults: MechanicResult[];
  presentNpcIds: string[];
  presentNpcs: Npc[];
  allTurns: Turn[];
  retrievedMemories: MemoryEntry[];
  playerInput: string;
}

export function assemble(input: AssembleInput): SceneContext {
  const visibleTurns = filterVisibleTurns(input.allTurns, input.presentNpcIds);
  const location = input.location;

  const history: HistoryEntry[] = [];
  for (const turn of visibleTurns) {
    const variant = turn.variants[turn.variants.length - 1];
    if (!variant) continue;
    history.push({ playerInput: turn.playerInput, sceneOutput: variant.sceneOutput });
  }

  const npcPayloads = input.presentNpcs.map((npc) => ({
    id: npc.id,
    name: npc.name,
    description: npc.description,
    personality: npc.personality,
    voiceExamples: npc.voiceExamples,
    agency: formatAgency(npc),
    trackers: npc.trackers,
  }));

  return {
    synopsis: input.synopsis,
    tension: input.tension,
    location,
    mechanicOutcomes: input.mechanicResults,
    presentNpcs: npcPayloads,
    filteredHistory: history,
    retrievedMemories: input.retrievedMemories,
    playerInput: input.playerInput,
  };
}

/**
 * Filter turns to only those visible to the currently present NPCs.
 *
 * A turn is visible if:
 *  - presentNpcIds is empty (solo player scene), OR
 *  - at least one currently present NPC was also present in that past turn
 *    (judged on the turn's LATEST variant — regenerate rewrites who was
 *    present, and the newest variant is the canonical branch).
 *
 * Exported so the orchestrator can apply context-window trimming between
 * visibility filtering and assembly (the trimmer must only ever see turns
 * that are already visibility-legal).
 */
export function filterVisibleTurns(allTurns: Turn[], presentNpcIds: string[]): Turn[] {
  // Solo player scene: all turns are visible.
  if (presentNpcIds.length === 0) return allTurns;

  const present = new Set(presentNpcIds);
  return allTurns.filter((turn) => {
    const variant = turn.variants[turn.variants.length - 1];
    if (!variant) return false;
    return variant.presentNpcIds.some((id) => present.has(id));
  });
}

/** Format NPC agency as a readable string for the prompt. */
function formatAgency(npc: Npc): string {
  const agency = npc.agency;
  const parts: string[] = [];
  if (agency.goal.trim().length > 0) parts.push(`Goal: ${agency.goal}`);
  if (agency.stance.trim().length > 0) parts.push(`Stance: ${agency.stance}`);
  if (agency.will_act_on.trim().length > 0) parts.push(`Will act on: ${agency.will_act_on}`);
  return parts.length === 0 ? 'No current agency state.' : parts.join(' | ');
}

/**
 * Format the scene context into a prompt string.
 * Order: synopsis, mechanics, NPCs, history, memories, player input.
 */
export function formatPrompt(context: SceneContext): string {
  const sections: string[] = [];

  // 1. Synopsis (+ pacing judgment + location when the scene has one)
  sections.push(`## Synopsis\n${context.synopsis}`);
  if (context.tension !== null && context.tension.length > 0) {
    sections.push(`Beat pacing: ${context.tension}`);
  }
  if (context.location.length > 0) {
    sections.push(`## Location\n${context.location}`);
  }

  // 2. Mechanic outcomes
  if (context.mechanicOutcomes.length > 0) {
    const mechanicsText = context.mechanicOutcomes
      .map(
        (result) =>
          `- ${result.skill} (DC ${result.dc}): ${result.tier.replace(/_/g, ' ')} ` +
          `(drew ${result.drawn.map((c) => c.name).join(', ')}, total ${result.value})`,
      )
      .join('\n');
    sections.push(`## Mechanic Outcomes\n${mechanicsText}\n\nNarrate these outcomes accordingly.`);
  }

  // 3. Present NPCs
  if (context.presentNpcs.length > 0) {
    const npcsText = context.presentNpcs
      .map((npc) => {
        let text = `### ${npc.name}\n`;
        text += `${npc.description}\n\n`;
        text += `**Personality:** ${npc.personality}\n\n`;
        if (npc.voiceExamples.length > 0) {
          text += '**Voice examples:**\n';
          for (const example of npc.voiceExamples) text += `- "${example}"\n`;
          text += '\n';
        }
        text += `**Agency:** ${npc.agency}\n\n`;
        if (Object.keys(npc.trackers).length > 0) {
          const trackers = Object.entries(npc.trackers)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
          text += `**Trackers:** ${trackers}`;
        }
        return text;
      })
      .join('\n\n');
    sections.push(`## Present NPCs\n${npcsText}`);
  }

  // 4. Filtered history. A turn with no player input (the opening scene,
  // turn 0) contributes only its sceneOutput — never an empty player line.
  if (context.filteredHistory.length > 0) {
    const historyText = context.filteredHistory
      .map((entry) =>
        entry.playerInput.trim().length > 0
          ? `**Player:** ${entry.playerInput}\n\n${entry.sceneOutput}`
          : entry.sceneOutput,
      )
      .join('\n\n');
    sections.push(`## Previous Events\n${historyText}`);
  }

  // 5. Retrieved memories
  if (context.retrievedMemories.length > 0) {
    const memoriesText = context.retrievedMemories.map((mem) => `- ${mem.fact}`).join('\n');
    sections.push(`## Recalled Facts\n${memoriesText}`);
  }

  // 6. Player input
  sections.push(`## Player Action\n${context.playerInput}`);

  return sections.join('\n\n');
}
