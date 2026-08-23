import { describe, expect, it } from 'vitest';
import { PipelineOrchestrator, type OrchestratorStores } from './orchestrator.js';
import type { AiCaller } from './ai-caller.js';
import type {
  Campaign,
  MemoryEntry,
  Npc,
  Turn,
  TurnVariant,
} from '../shared/types.js';
import type { RandomSource } from './deck.js';

// ---- deterministic RNG (stands in for Kotlin Random(seed)) -----------------

function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    nextInt(minInclusive: number, maxExclusive: number): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return minInclusive + Math.floor(r * (maxExclusive - minInclusive));
    },
  };
}

// ---- scripted AiCaller ------------------------------------------------------

type StageName = 'router' | 'plot' | 'agency' | 'extraction' | 'unknown';

class FakeAiCaller implements AiCaller {
  structuredCalls: StageName[] = [];
  proseCalls = 0;
  lastScenePrompt: string | null = null;
  lastSceneSystem: string | null = null;

  constructor(
    public routerJson = '{"needs_check":false,"checks":[],"run_agency_update":false,"lore_query":null}',
    public plotJson =
      '{"synopsis":"Something happens.","present_npcs":[],"scene_change":false,"location":null,"tracker_updates":[]}',
    public agencyJson = '{"goal":"g","stance":"s","will_act_on":"w"}',
    public extractionJson = '[]',
    public proseChunks: string[] = ['Once ', 'upon ', 'a time.'],
    public proseThrows = false,
  ) {}

  async generateStructured<T>(
    systemPrompt: string,
    _userPrompt: string,
    decoder: (raw: string) => T,
    fallback: T,
  ): Promise<T> {
    let stage: StageName;
    if (/router/i.test(systemPrompt)) stage = 'router';
    else if (/plot engine/i.test(systemPrompt)) stage = 'plot';
    else if (/inner life/i.test(systemPrompt)) stage = 'agency';
    else if (/Extract durable facts/i.test(systemPrompt)) stage = 'extraction';
    else stage = 'unknown';
    this.structuredCalls.push(stage);

    const payload =
      stage === 'router'
        ? this.routerJson
        : stage === 'plot'
          ? this.plotJson
          : stage === 'agency'
            ? this.agencyJson
            : stage === 'extraction'
              ? this.extractionJson
              : null;
    if (payload === null) return fallback;
    // Mirror the real caller's contract: never throw, fall back instead.
    try {
      return decoder(payload);
    } catch {
      return fallback;
    }
  }

  async *streamProse(
    systemPrompt: string,
    userPrompt: string,
    hooks?: { onReasoningChunk?: ((chunk: string) => void) | null },
  ): AsyncGenerator<string> {
    this.proseCalls++;
    this.lastSceneSystem = systemPrompt;
    this.lastScenePrompt = userPrompt;
    if (this.proseThrows) throw new Error('scene model exploded');
    for (const chunk of this.proseChunks) yield chunk;
    hooks?.onReasoningChunk?.('');
  }

  async *streamThink(
    systemPrompt: string,
    userPrompt: string,
    hooks?: { onReasoningChunk?: ((chunk: string) => void) | null },
  ): AsyncGenerator<string> {
    yield* this.streamProse(systemPrompt, userPrompt, hooks);
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
    sessionPlan: 'Act 1: arrive. Act 2: betrayal.',
    playerPersona: '',
    openingMessage: '',
    sceneState: { location: 'The Docks', presentNpcIds: ['alice'] },
    thinkModel: null,
    writeModel: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function npcOf(id: string, trust: number): Npc {
  return {
    id,
    name: `NPC ${id}`,
    description: `desc ${id}`,
    personality: `personality ${id}`,
    firstMessage: '',
    voiceExamples: [`line ${id}`],
    agency: { goal: `old-goal-${id}`, stance: `old-stance-${id}`, will_act_on: `old-act-${id}` },
    trackers: { trust },
    sourceCard: null,
  };
}

interface Rig {
  fake: FakeAiCaller;
  stores: OrchestratorStores;
  orch: PipelineOrchestrator;
}

type FakeOverrides = {
  routerJson?: string;
  plotJson?: string;
  agencyJson?: string;
  extractionJson?: string;
  proseChunks?: string[];
  proseThrows?: boolean;
};

function rig(
  fakeOverrides: FakeOverrides = {},
  options: { contextWindowTokens?: number; writeMaxTokens?: number } = {},
): Rig {
  const fake = new FakeAiCaller(
    (fakeOverrides['routerJson'] as string | undefined),
    (fakeOverrides['plotJson'] as string | undefined),
    (fakeOverrides['agencyJson'] as string | undefined),
    (fakeOverrides['extractionJson'] as string | undefined),
    (fakeOverrides['proseChunks'] as string[] | undefined),
    (fakeOverrides['proseThrows'] as boolean | undefined),
  );
  const stores = memoryStores();
  const orch = new PipelineOrchestrator({
    aiCaller: fake,
    stores,
    random: seededRandom(7),
    contextWindowTokens: options.contextWindowTokens ?? 32768,
    writeMaxTokens: options.writeMaxTokens ?? 8192,
    makeId: (() => {
      let n = 0;
      return () => `test-id-${n++}`;
    })(),
  });
  return { fake, stores, orch };
}

interface RigWithStores extends Rig {
  stores: OrchestratorStores;
}

async function seedRig(
  fakeOverrides: FakeOverrides = {},
  options: { contextWindowTokens?: number; writeMaxTokens?: number } = {},
): Promise<Rig & { stores: OrchestratorStores }> {
  const r = rig(fakeOverrides, options);
  await r.stores.saveCampaign(baseCampaign());
  await r.stores.saveNpc(campaignId, npcOf('alice', 2));
  await r.stores.saveNpc(campaignId, npcOf('bob', 0));
  return r;
}

async function saveSeedTurn(
  stores: OrchestratorStores,
  overrides: { index: number; playerInput: string; variants: TurnVariant[] },
): Promise<void> {
  await stores.saveTurn(campaignId, {
    index: overrides.index,
    playerInput: overrides.playerInput,
    variants: overrides.variants,
    createdAt: 0,
  });
}

function variantOf(overrides: Partial<TurnVariant>): TurnVariant {
  return {
    id: 'v',
    synopsis: 's',
    sceneOutput: '',
    routerDecision: null,
    presentNpcIds: [],
    mechanicResults: [],
    interrupted: false,
    timestamp: 0,
    stageEvents: [],
    reasoning: null,
    ...overrides,
  };
}

// ---- tests -------------------------------------------------------------------

describe('PipelineOrchestrator', () => {
  // ---- happy path ------------------------------------------------------

  it('full turn streams prose saves the turn and returns the variant', async () => {
    const { fake, stores, orch } = await seedRig({
      plotJson:
        '{"synopsis":"The rope snaps.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
      proseChunks: ['You ', 'fall.'],
    });

    const chunks: string[] = [];
    const variant = await orch.executeTurn({
      campaignId,
      playerInput: 'grab the rope',
      onChunk: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(['You ', 'fall.']);
    expect(variant.sceneOutput).toBe('You fall.');
    expect(variant.synopsis).toBe('The rope snaps.');
    expect(variant.interrupted).toBe(false);

    const saved = await stores.loadTurn(campaignId, 0);
    expect(saved).not.toBeNull();
    expect(saved!.playerInput).toBe('grab the rope');
    expect(saved!.variants).toHaveLength(1);
    expect(saved!.variants[0].sceneOutput).toBe('You fall.');
  });

  it('stages run in pipeline order', async () => {
    const { fake, orch } = await seedRig();
    await orch.executeTurn({ campaignId, playerInput: 'look around' });
    // Agency is conditional and off here; router precedes plot precedes extraction.
    expect(fake.structuredCalls).toEqual(['router', 'plot', 'extraction']);
  });

  it('turn indices increment across successive turns', async () => {
    const { stores, orch } = await seedRig();
    await orch.executeTurn({ campaignId, playerInput: 'first' });
    await orch.executeTurn({ campaignId, playerInput: 'second' });
    expect(await stores.listTurnIndices(campaignId)).toEqual([0, 1]);
    const second = await stores.loadTurn(campaignId, 1);
    expect(second!.playerInput).toBe('second');
  });

  it('targetTurnIndex appends a variant to the existing turn', async () => {
    const { stores, orch } = await seedRig();
    await orch.executeTurn({ campaignId, playerInput: 'first' });
    await orch.executeTurn({ campaignId, playerInput: 'first', targetTurnIndex: 0 });
    const turn = await stores.loadTurn(campaignId, 0);
    expect(turn!.variants).toHaveLength(2);
    expect(await stores.listTurnIndices(campaignId)).toEqual([0]);
  });

  // ---- mechanics wiring --------------------------------------------------

  it('router requesting a check produces a mechanic result on the variant', async () => {
    const { orch } = await seedRig({
      routerJson:
        '{"needs_check":true,"checks":[{"skill":"athletics","dc":10,"modifier":0,"advantage":0}],"run_agency_update":false,"lore_query":null}',
    });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'leap the gap' });
    expect(variant.mechanicResults).toHaveLength(1);
    const result = variant.mechanicResults[0];
    expect(result.skill).toBe('athletics');
    expect(result.dc).toBe(10);
    expect(['critical_success', 'success', 'partial', 'failure']).toContain(result.tier);
  });

  it('mechanic outcomes reach the scene prompt', async () => {
    const { fake, orch } = await seedRig({
      routerJson:
        '{"needs_check":true,"checks":[{"skill":"athletics","dc":10,"modifier":0,"advantage":0}],"run_agency_update":false,"lore_query":null}',
    });
    await orch.executeTurn({ campaignId, playerInput: 'leap the gap' });
    expect(fake.lastScenePrompt).toContain('athletics');
  });

  it('no check means no mechanic results', async () => {
    const { orch } = await seedRig();
    const variant = await orch.executeTurn({ campaignId, playerInput: 'sit quietly' });
    expect(variant.mechanicResults).toHaveLength(0);
  });

  // ---- state updates -----------------------------------------------------

  it('tracker deltas are applied to the stored NPC', async () => {
    const { stores, orch } = await seedRig({
      plotJson:
        '{"synopsis":"She recoils.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"alice","key":"trust","delta":-3}]}',
    });
    await orch.executeTurn({ campaignId, playerInput: 'insult alice' });
    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice!.trackers['trust']).toBe(-1); // started at 2, delta -3
  });

  it('tracker update on an unseen key starts from zero', async () => {
    const { stores, orch } = await seedRig({
      plotJson:
        '{"synopsis":"Coins change hands.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"alice","key":"coin","delta":7}]}',
    });
    await orch.executeTurn({ campaignId, playerInput: 'pay alice' });
    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice!.trackers['coin']).toBe(7);
  });

  it('scene change updates location and present NPCs', async () => {
    const { stores, orch } = await seedRig({
      plotJson:
        '{"synopsis":"You arrive.","present_npcs":["bob"],"scene_change":true,"location":"The Chapel","tracker_updates":[]}',
    });
    await orch.executeTurn({ campaignId, playerInput: 'go to the chapel' });
    const state = (await stores.loadCampaign(campaignId))!.sceneState;
    expect(state.location).toBe('The Chapel');
    expect(state.presentNpcIds).toEqual(['bob']);
  });

  it('blank location keeps the previous location', async () => {
    const { stores, orch } = await seedRig();
    await orch.executeTurn({ campaignId, playerInput: 'wait' });
    expect((await stores.loadCampaign(campaignId))!.sceneState.location).toBe('The Docks');
  });

  // ---- memory ------------------------------------------------------------

  it('extracted memories are appended to storage', async () => {
    const { stores, orch } = await seedRig({
      extractionJson:
        '[{"scope":"campaign","npc_id":null,"fact":"The bridge is out."},{"scope":"npc","npc_id":"alice","fact":"Alice fears water."}]',
    });
    await orch.executeTurn({ campaignId, playerInput: 'cross the bridge' });
    const stored = await stores.loadMemories(campaignId);
    expect(stored).toHaveLength(2);
    expect(stored.some((m) => m.fact === 'The bridge is out.' && m.scope === 'campaign')).toBe(true);
    expect(stored.some((m) => m.fact === 'Alice fears water.' && m.npc_id === 'alice')).toBe(true);
    expect(stored.every((m) => m.turn === 0)).toBe(true);
  });

  it('empty extraction appends nothing', async () => {
    const { stores, orch } = await seedRig({ extractionJson: '[]' });
    await orch.executeTurn({ campaignId, playerInput: 'breathe' });
    expect(await stores.loadMemories(campaignId)).toHaveLength(0);
  });

  // ---- agency ------------------------------------------------------------

  it('agency runs when the router asks for it', async () => {
    const { fake, stores, orch } = await seedRig({
      routerJson: '{"needs_check":false,"checks":[],"run_agency_update":true,"lore_query":null}',
      plotJson:
        '{"synopsis":"A shift.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
      agencyJson: '{"goal":"new-goal","stance":"new-stance","will_act_on":"new-act"}',
    });
    await orch.executeTurn({ campaignId, playerInput: 'confess' });
    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice!.agency.goal).toBe('new-goal');
    expect(alice!.agency.stance).toBe('new-stance');
    expect(alice!.agency.will_act_on).toBe('new-act');
    expect(fake.structuredCalls).toContain('agency');
  });

  it('agency is skipped on a quiet turn', async () => {
    const { fake, stores, orch } = await seedRig();
    await orch.executeTurn({ campaignId, playerInput: 'nod' });
    expect(fake.structuredCalls).not.toContain('agency');
    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice!.agency.goal).toBe('old-goal-alice');
  });

  it('agency only sees turns the NPC witnessed', async () => {
    const { fake, stores, orch } = await seedRig({
      routerJson: '{"needs_check":false,"checks":[],"run_agency_update":true,"lore_query":null}',
      plotJson:
        '{"synopsis":"A shift.","present_npcs":["bob"],"scene_change":false,"location":null,"tracker_updates":[]}',
      agencyJson: '{"goal":"new-goal","stance":"new-stance","will_act_on":"new-act"}',
    });
    await stores.saveTurn(campaignId, {
      index: 0,
      playerInput: 'PLOT_WITH_BOB',
      createdAt: 0,
      variants: [variantOf({ sceneOutput: 'BOB_ONLY_SCENE', presentNpcIds: ['bob'], synopsis: 'bob saw this' })],
    });
    await orch.executeTurn({ campaignId, playerInput: 'talk to bob' });
    // The update ran without crashing and bob's agency changed.
    const bob = await stores.loadNpc(campaignId, 'bob');
    expect(bob!.agency.goal).toBe('new-goal');
    expect(fake.structuredCalls).toContain('agency');
  });

  // ---- visibility, end to end ---------------------------------------------

  it('scene prompt excludes turns the present NPC did not witness', async () => {
    const { fake, orch, stores: orchStores } = await seedRig({
      plotJson:
        '{"synopsis":"Alice turns.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
    });
    await saveSeedTurn(orchStores, {
      index: 0,
      playerInput: 'PLOT_WITH_BOB',
      variants: [variantOf({ sceneOutput: 'BOB_ONLY_SCENE', presentNpcIds: ['bob'] })],
    });
    await orch.executeTurn({ campaignId, playerInput: 'ask alice' });
    const prompt = fake.lastScenePrompt!;
    expect(prompt).not.toContain('BOB_ONLY_SCENE');
    expect(prompt).not.toContain('PLOT_WITH_BOB');
  });

  it('scene prompt includes turns the present NPC witnessed', async () => {
    const { fake, orch, stores: orchStores } = await seedRig({
      plotJson:
        '{"synopsis":"Alice speaks.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
    });
    await saveSeedTurn(orchStores, {
      index: 0,
      playerInput: 'earlier',
      variants: [variantOf({ sceneOutput: 'ALICE_WITNESSED_SCENE', presentNpcIds: ['alice'] })],
    });
    await orch.executeTurn({ campaignId, playerInput: 'ask alice again' });
    expect(fake.lastScenePrompt).toContain('ALICE_WITNESSED_SCENE');
  });

  // ---- resilience ---------------------------------------------------------

  it('malformed plot JSON falls back without crashing the turn', async () => {
    const { stores, orch } = await seedRig({ plotJson: 'this is not json at all' });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'do something' });
    expect(variant.synopsis).toBe('The moment stretches; the situation stays tense.');
    expect(await stores.loadTurn(campaignId, 0)).not.toBeNull();
  });

  it('malformed router JSON falls back to no check', async () => {
    const { stores, orch } = await seedRig({ routerJson: '{{{garbage' });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'swing wildly' });
    expect(variant.mechanicResults).toHaveLength(0);
    expect(await stores.loadTurn(campaignId, 0)).not.toBeNull();
  });

  it('plot fallback keeps the previous scene state', async () => {
    const { stores, orch } = await seedRig({ plotJson: 'not json' });
    await orch.executeTurn({ campaignId, playerInput: 'hesitate' });
    const state = (await stores.loadCampaign(campaignId))!.sceneState;
    expect(state.location).toBe('The Docks');
    expect(state.presentNpcIds).toEqual(['alice']);
  });

  it('a failing scene stage marks the variant interrupted but still saves', async () => {
    const { stores, orch } = await seedRig({ proseThrows: true });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'provoke the storm' });
    expect(variant.interrupted).toBe(true);
    expect(variant.sceneOutput).toBe('');
    expect(await stores.loadTurn(campaignId, 0)).not.toBeNull();
  });

  it('empty prose is treated as interrupted', async () => {
    const { orch } = await seedRig({ proseChunks: [] });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'stare' });
    expect(variant.interrupted).toBe(true);
  });

  it('malformed extraction JSON does not fail the turn', async () => {
    const { stores, orch } = await seedRig({ extractionJson: 'nope' });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'remember this' });
    expect(variant.interrupted).toBe(false);
    expect(await stores.loadMemories(campaignId)).toHaveLength(0);
  });

  it('tracker update naming an unknown NPC is ignored', async () => {
    const { stores, orch } = await seedRig({
      plotJson:
        '{"synopsis":"A ghost stirs.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"nobody","key":"trust","delta":5}]}',
    });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'address the void' });
    expect(variant.interrupted).toBe(false);
    const alice = await stores.loadNpc(campaignId, 'alice');
    expect(alice!.trackers['trust']).toBe(2);
  });

  it('missing campaign throws', async () => {
    const r = rig();
    await expect(r.orch.executeTurn({ campaignId, playerInput: 'x' })).rejects.toThrow(
      /Campaign camp-1 not found/,
    );
  });

  // ---- stage events (pipeline transparency) --------------------------------

  it('malformed plot JSON records a fallback stage event on the variant', async () => {
    const { stores, orch } = await seedRig({ plotJson: 'this is not json at all' });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'do something' });
    expect(variant.stageEvents.some((e) => e.startsWith('plot: fallback used'))).toBe(true);
    const saved = (await stores.loadTurn(campaignId, 0))!.variants[0];
    expect(saved.stageEvents.some((e) => e.startsWith('plot: fallback used'))).toBe(true);
  });

  it('a clean turn has an empty stage event list', async () => {
    const { orch } = await seedRig();
    const variant = await orch.executeTurn({ campaignId, playerInput: 'look around' });
    expect(variant.stageEvents).toEqual([]);
  });

  it('scene failure records an interrupted stage event', async () => {
    const { orch } = await seedRig({ proseThrows: true });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'provoke' });
    expect(variant.stageEvents.some((e) => e.startsWith('scene: interrupted') && e.includes('scene model exploded'))).toBe(true);
  });

  it('applied tracker update records a stage event', async () => {
    const { orch } = await seedRig({
      plotJson:
        '{"synopsis":"She recoils.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[{"npc":"alice","key":"trust","delta":-3}]}',
    });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'insult alice' });
    expect(variant.stageEvents).toContain('tracker: trust -3 applied to alice');
    // Agency runs because a tracker update happened; that is recorded too.
    expect(variant.stageEvents.some((e) => e.startsWith('agency: run'))).toBe(true);
  });

  it('records the exact sentinel-triggered plot fallback event wording', async () => {
    // A model that literally returns the sentinel synopsis must be flagged.
    const { orch } = await seedRig({
      plotJson:
        '{"synopsis":"The moment stretches; the situation stays tense.","present_npcs":[],"scene_change":false,"location":null,"tracker_updates":[]}',
    });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'test' });
    expect(variant.stageEvents).toContain('plot: fallback used (json parse failed)');
  });

  // ---- context window enforcement ------------------------------------------

  it('oversized history is trimmed and records a stage event', async () => {
    // Budget = (1024 - 512) * 0.8 = 409 tokens = 1636 chars. Three past
    // turns of ~4000 chars each: only the newest survives.
    const { fake, orch, stores: orchStores } = await seedRig(
      {
        plotJson:
          '{"synopsis":"Continues.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
      },
      { contextWindowTokens: 1024, writeMaxTokens: 512 },
    );
    for (let i = 0; i <= 2; i++) {
      await saveSeedTurn(orchStores, {
        index: i,
        playerInput: `TURN_${i}_INPUT`,
        variants: [
          variantOf({
            sceneOutput: `TURN_${i}_SCENE ${'x'.repeat(4000)}`,
            presentNpcIds: ['alice'],
          }),
        ],
      });
    }
    const variant = await orch.executeTurn({ campaignId, playerInput: 'press on' });

    expect(
      variant.stageEvents.some((e) => e.startsWith('context: history trimmed to last 1 turns')),
      `expected a trim event, got ${JSON.stringify(variant.stageEvents)}`,
    ).toBe(true);
    expect(variant.stageEvents).toContain('context: history trimmed to last 1 turns (budget 409 tokens)');
    // The newest turn stays in the prompt; the oldest is gone.
    const prompt = fake.lastScenePrompt!;
    expect(prompt).toContain('TURN_2_SCENE');
    expect(prompt).not.toContain('TURN_0_SCENE');
  });

  it('history under the budget is not trimmed and records no event', async () => {
    const { fake, orch, stores: orchStores } = await seedRig({
      plotJson:
        '{"synopsis":"Continues.","present_npcs":["alice"],"scene_change":false,"location":null,"tracker_updates":[]}',
    });
    await saveSeedTurn(orchStores, {
      index: 0,
      playerInput: 'small',
      variants: [variantOf({ sceneOutput: 'SMALL_SCENE', presentNpcIds: ['alice'] })],
    });
    const variant = await orch.executeTurn({ campaignId, playerInput: 'press on' });
    expect(variant.stageEvents.some((e) => e.startsWith('context:'))).toBe(false);
    expect(fake.lastScenePrompt).toContain('SMALL_SCENE');
  });

  // ---- pipeline events callback (live progress) -----------------------------

  it('onPipelineEvent receives stage boundary events on happy path', async () => {
    const { fake, orch } = await seedRig();
    const events: string[] = [];
    const hookOrch = new PipelineOrchestrator({
      aiCaller: fake,
      stores: orch['stores'] as OrchestratorStores,
      random: seededRandom(7),
      onPipelineEvent: (e) => events.push(e),
      makeId: () => 'id',
    });
    await hookOrch.executeTurn({ campaignId, playerInput: 'look around' });
    expect(events).toEqual([
      'router: deciding checks…',
      'router: done',
      'plot: generating turn plan…',
      'plot: done',
      'scene: streaming…',
      'memory: extracting…',
      'memory: done',
    ]);
  });

  it('per-call onPipelineEvent overrides the constructor hook', async () => {
    const { fake, orch } = await seedRig();
    const constructorEvents: string[] = [];
    const callEvents: string[] = [];
    const hookOrch = new PipelineOrchestrator({
      aiCaller: fake,
      stores: orch['stores'] as OrchestratorStores,
      random: seededRandom(7),
      onPipelineEvent: (e) => constructorEvents.push(e),
      makeId: () => 'id',
    });
    await hookOrch.executeTurn({
      campaignId,
      playerInput: 'test',
      onPipelineEvent: (e) => callEvents.push(e),
    });
    expect(constructorEvents).toEqual([]);
    expect(callEvents.length).toBeGreaterThan(0);
  });

  it('onPipelineEvent receives fallback events and matches persisted stageEvents order', async () => {
    const { fake, orch } = await seedRig({ plotJson: 'garbage' });
    const events: string[] = [];
    const hookOrch = new PipelineOrchestrator({
      aiCaller: fake,
      stores: orch['stores'] as OrchestratorStores,
      random: seededRandom(7),
      onPipelineEvent: (e) => events.push(e),
      makeId: () => 'id',
    });
    const variant = await hookOrch.executeTurn({ campaignId, playerInput: 'test' });
    expect(events.some((e) => e.startsWith('plot: fallback used'))).toBe(true);
    // Every persisted stageEvents line was also emitted live, in order.
    expect(events.filter((e) => variant.stageEvents.includes(e))).toEqual(variant.stageEvents);
  });

  // ---- reasoning tap ---------------------------------------------------------

  it('reasoning chunks are tapped live and stored on the variant', async () => {
    const { fake, orch } = await seedRig();

    class ReasoningFake extends FakeAiCaller {
      override async *streamProse(
        systemPrompt: string,
        userPrompt: string,
        hooks?: { onReasoningChunk?: ((chunk: string) => void) | null },
      ): AsyncGenerator<string> {
        this.proseCalls++;
        this.lastSceneSystem = systemPrompt;
        this.lastScenePrompt = userPrompt;
        hooks?.onReasoningChunk?.('thinking about ');
        hooks?.onReasoningChunk?.('the beat');
        yield 'Prose.';
      }
    }

    const reasoningFake = new ReasoningFake(
      fake.routerJson,
      fake.plotJson,
      fake.agencyJson,
      fake.extractionJson,
      fake.proseChunks,
      fake.proseThrows,
    );
    const reasoningOrch = new PipelineOrchestrator({
      aiCaller: reasoningFake,
      stores: orch['stores'] as OrchestratorStores,
      random: seededRandom(7),
      makeId: () => 'id',
    });

    const tapped: string[] = [];
    const variant = await reasoningOrch.executeTurn({
      campaignId,
      playerInput: 'go',
      onReasoningChunk: (c) => tapped.push(c),
    });
    expect(tapped.join('')).toBe('thinking about the beat');
    expect(variant.reasoning).toBe('thinking about the beat');

    const noTapVariant = await reasoningOrch.executeTurn({ campaignId, playerInput: 'go again' });
    expect(noTapVariant.reasoning).toBe('thinking about the beat');
  });

  it('variant has no reasoning when the model emitted none', async () => {
    const { orch } = await seedRig();
    const variant = await orch.executeTurn({ campaignId, playerInput: 'quiet' });
    expect(variant.reasoning).toBeNull();
  });
});
