/**
 * Phase 5 orchestrator tests: prompt-template overrides reach the assembled
 * prompts, and tracker updates resolve NPC names to ids.
 */

import { describe, expect, it } from 'vitest';

import { PipelineOrchestrator, type OrchestratorStores } from './orchestrator.js';
import type { AiCaller } from './ai-caller.js';
import type { PromptTemplateGetter } from './prompt-templates.js';
import type { Campaign, MemoryEntry, Npc, Turn } from '../shared/types.js';

// ---- minimal scripted caller ------------------------------------------------

class CaptureCaller implements AiCaller {
  sceneSystem: string | null = null;
  sceneUser: string | null = null;
  agencySystem: string | null = null;
  structuredSystems: string[] = [];

  constructor(
    public plotJson: string,
    public proseChunks: string[] = ['Prose.'],
  ) {}

  async generateStructured<T>(
    systemPrompt: string,
    _userPrompt: string,
    decoder: (raw: string) => T,
    fallback: T,
  ): Promise<T> {
    // Stage identity must NOT depend on the system prompt text (overrides
    // replace it), so route by pipeline call order: router -> plot -> agency.
    this.structuredSystems.push(systemPrompt);
    const callIndex = this.structuredSystems.length - 1;
    if (callIndex === 0) {
      return decoder('{"needs_check":false,"checks":[],"run_agency_update":false,"lore_query":null}');
    }
    if (callIndex === 1) return decoder(this.plotJson);
    this.agencySystem = systemPrompt;
    return decoder('{"goal":"g","stance":"s","will_act_on":"w"}');
  }

  async *streamProse(systemPrompt: string, userPrompt: string): AsyncGenerator<string> {
    this.sceneSystem = systemPrompt;
    this.sceneUser = userPrompt;
    for (const chunk of this.proseChunks) yield chunk;
  }

  async *streamThink(systemPrompt: string, _userPrompt: string): AsyncGenerator<string> {
    yield systemPrompt;
  }
}

// ---- in-memory stores --------------------------------------------------------

function memoryStores(): OrchestratorStores {
  const campaigns = new Map<string, Campaign>();
  const npcs = new Map<string, Npc>();
  const turnsByIndex = new Map<number, Turn>();
  const memories: MemoryEntry[] = [];
  return {
    async loadCampaign(id) {
      return campaigns.get(id) ?? null;
    },
    async saveCampaign(campaign) {
      campaigns.set(campaign.id, campaign);
    },
    async listTurnIndices() {
      return [...turnsByIndex.keys()].sort((a, b) => a - b);
    },
    async loadTurn(_id, index) {
      return turnsByIndex.get(index) ?? null;
    },
    async saveTurn(_id, turn) {
      turnsByIndex.set(turn.index, JSON.parse(JSON.stringify(turn)) as Turn);
    },
    async appendVariant(_id, index, variant) {
      const turn = turnsByIndex.get(index);
      if (!turn) throw new Error('missing turn');
      turn.variants.push(variant);
    },
    async loadNpc(_id, npcId) {
      return npcs.get(npcId) ?? null;
    },
    async saveNpc(_id, npc) {
      npcs.set(npc.id, JSON.parse(JSON.stringify(npc)) as Npc);
    },
    async loadMemories() {
      return memories.map((m) => ({ ...m }));
    },
    async appendMemory(_id, entry) {
      memories.push({ ...entry });
    },
  };
}

// ---- fixtures ----------------------------------------------------------------

const campaignId = 'camp-1';

function baseCampaign(): Campaign {
  return {
    id: campaignId,
    title: 'Test Campaign',
    premise: 'A premise',
    sessionPlan: 'Act 1.',
    playerPersona: '',
    openingMessage: '',
    sceneState: { location: 'The Docks', presentNpcIds: ['alice'] },
    thinkModel: null,
    writeModel: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function npcOf(id: string, name: string): Npc {
  return {
    id,
    name,
    description: `desc ${id}`,
    personality: 'gruff',
    firstMessage: '',
    voiceExamples: [],
    agency: { goal: '', stance: '', will_act_on: '' },
    trackers: { trust: 2 },
    sourceCard: null,
  };
}

interface Rig {
  fake: CaptureCaller;
  stores: OrchestratorStores;
  orch: PipelineOrchestrator;
}

function rig(
  plotJson: string,
  getTemplates?: PromptTemplateGetter | null,
): Rig {
  const fake = new CaptureCaller(plotJson);
  const stores = memoryStores();
  const orch = new PipelineOrchestrator({
    aiCaller: fake,
    stores,
    getTemplates: getTemplates ?? null,
    makeId: (() => {
      let n = 0;
      return () => `id-${n++}`;
    })(),
  });
  return { fake, stores, orch };
}

async function seed(stores: OrchestratorStores, npc: Npc): Promise<void> {
  await stores.saveCampaign(baseCampaign());
  await stores.saveNpc(campaignId, npc);
}

const PLOT_WITH_NAME_TRACKER =
  '{"synopsis":"She recoils.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"lira","key":"trust","delta":-3}]}';

describe('prompt template overrides in the pipeline', () => {
  it('applies a scene override with variables interpolated', async () => {
    const getTemplates: PromptTemplateGetter = (key) =>
      key === 'scene' ? 'Voice: {{playerInput}} / {{synopsis}} / {{missingVar}}' : null;
    const { fake, orch, stores } = rig(PLOT_WITH_NAME_TRACKER, getTemplates);
    await seed(stores, npcOf('alice', 'Lira'));

    await orch.executeTurn({ campaignId, playerInput: 'I knock twice.' });

    expect(fake.sceneSystem).toBe('Voice: I knock twice. / She recoils. / {{missingVar}}');
  });

  it('uses the default narrator voice without an override', async () => {
    const { fake, orch, stores } = rig(PLOT_WITH_NAME_TRACKER, null);
    await seed(stores, npcOf('alice', 'Lira'));

    await orch.executeTurn({ campaignId, playerInput: 'I knock twice.' });

    expect(fake.sceneSystem).toContain('You are the narrator of a tabletop campaign');
  });

  it('applies a plot override with sessionPlan and storySoFar', async () => {
    const getTemplates: PromptTemplateGetter = (key) =>
      key === 'plot' ? 'Plan: {{sessionPlan}} | So far: {{storySoFar}}' : null;
    const { fake, orch, stores } = rig(PLOT_WITH_NAME_TRACKER, getTemplates);
    await seed(stores, npcOf('alice', 'Lira'));

    const variant = await orch.executeTurn({ campaignId, playerInput: 'Go on.' });
    expect(variant.synopsis).toBe('She recoils.');
    // Call order: [0] router, [1] plot, [2] agency. The plot override wins.
    expect(fake.structuredSystems[0]).toContain('You are the router');
    expect(fake.structuredSystems[1]).toBe(
      'Plan: Act 1. | So far: Campaign just started.',
    );
  });
});

describe('tracker update name resolution', () => {
  it('applies an update keyed by lowercase name to the right npc', async () => {
    const { orch, stores } = rig(PLOT_WITH_NAME_TRACKER, null);
    await seed(stores, npcOf('alice', 'Lira'));

    const variant = await orch.executeTurn({ campaignId, playerInput: 'Threaten her.' });

    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice?.trackers['trust']).toBe(-1); // 2 + (-3)
    expect(variant.stageEvents).toContain('tracker: trust -3 applied to Lira (resolved by name)');
  });

  it('still applies updates keyed by exact npc id', async () => {
    const plotJson =
      '{"synopsis":"A shift.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"alice","key":"trust","delta":1}]}';
    const { orch, stores } = rig(plotJson, null);
    await seed(stores, npcOf('alice', 'Lira'));

    const variant = await orch.executeTurn({ campaignId, playerInput: 'Continue.' });

    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice?.trackers['trust']).toBe(3);
    expect(variant.stageEvents).toContain('tracker: trust +1 applied to alice');
  });

  it('skips and records the event when nothing resolves', async () => {
    const plotJson =
      '{"synopsis":"A ghost stirs.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"nobody","key":"trust","delta":5}]}';
    const { orch, stores } = rig(plotJson, null);
    await seed(stores, npcOf('alice', 'Lira'));

    const variant = await orch.executeTurn({ campaignId, playerInput: 'Wait.' });

    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice?.trackers['trust']).toBe(2);
    expect(variant.stageEvents).toContain('tracker: update skipped, unknown npc nobody');
  });

  it('resolves by trimmed-name containment as a last resort', async () => {
    const getTemplates: PromptTemplateGetter | null = null;
    const plotJson =
      '{"synopsis":"She nods.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"Lady Lira of the Docks","key":"trust","delta":2}]}';
    const { orch, stores } = rig(plotJson, getTemplates);
    await seed(stores, npcOf('alice', 'Lira'));

    const variant = await orch.executeTurn({ campaignId, playerInput: 'Bow.' });

    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice?.trackers['trust']).toBe(4);
    expect(variant.stageEvents).toContain('tracker: trust +2 applied to Lira (resolved by name)');
  });
});
