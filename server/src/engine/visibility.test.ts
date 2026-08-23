import { describe, expect, it } from 'vitest';
import * as VisibilityContextAssembler from './visibility.js';
import type { MemoryEntry, Npc, Turn } from '../shared/types.js';

function turn(
  index: number,
  input: string,
  presentNpcIds: string[],
  sceneOutput = `scene-${index}`,
  synopsis = `synopsis-${index}`,
): Turn {
  return {
    index,
    playerInput: input,
    createdAt: 0,
    variants: [
      {
        id: `v${index}`,
        synopsis,
        sceneOutput,
        routerDecision: null,
        presentNpcIds,
        mechanicResults: [],
        interrupted: false,
        timestamp: 0,
        stageEvents: [], tension: null,
        reasoning: null,
      },
    ],
  };
}

function variantOf(overrides: Partial<Turn['variants'][number]>): Turn['variants'][number] {
  return {
    id: 'v',
    synopsis: 's',
    sceneOutput: '',
    routerDecision: null,
    presentNpcIds: [],
    mechanicResults: [],
    interrupted: false,
    timestamp: 0,
    stageEvents: [], tension: null,
    reasoning: null,
    ...overrides,
  };
}

function npc(id: string, name = `NPC ${id}`): Npc {
  return {
    id,
    name,
    description: `desc of ${name}`,
    personality: `personality of ${name}`,
    firstMessage: '',
    voiceExamples: [`A line from ${name}`],
    agency: { goal: `goal-${id}`, stance: `stance-${id}`, will_act_on: `act-${id}` },
    trackers: { trust: 3 },
    sourceCard: null,
  };
}

function assemble(options: {
  presentNpcIds: string[];
  allTurns: Turn[];
  presentNpcs?: Npc[];
  synopsis?: string;
  location?: string;
  memories?: MemoryEntry[];
  playerInput?: string;
}) {
  return VisibilityContextAssembler.assemble({
    synopsis: options.synopsis ?? 'fresh synopsis',
    tension: null,
    location: options.location ?? 'The Docks',
    mechanicResults: [],
    presentNpcIds: options.presentNpcIds,
    presentNpcs: options.presentNpcs ?? options.presentNpcIds.map((id) => npc(id)),
    allTurns: options.allTurns,
    retrievedMemories: options.memories ?? [],
    playerInput: options.playerInput ?? 'current input',
  });
}

describe('VisibilityContextAssembler', () => {
  // ---- the exclusion half of the invariant -----------------------------

  it('turns where none of the present NPCs were present are excluded', () => {
    const turns = [
      turn(0, 'talk to alice', ['alice'], 'ALICE_SCENE'),
      turn(1, 'secret meeting with bob', ['bob'], 'BOB_SECRET'),
    ];
    const context = assemble({ presentNpcIds: ['alice'], allTurns: turns });
    const outputs = context.filteredHistory.map((h) => h.sceneOutput);
    expect(outputs).toContain('ALICE_SCENE');
    expect(outputs).not.toContain('BOB_SECRET');
    expect(context.filteredHistory).toHaveLength(1);
  });

  it('excluded turns leak neither prose nor player input into the prompt', () => {
    const turns = [
      turn(0, 'PLAYER_SECRET_PLAN', ['bob'], 'BOB_SECRET'),
      turn(1, 'greet alice', ['alice'], 'ALICE_SCENE'),
    ];
    const context = assemble({ presentNpcIds: ['alice'], allTurns: turns });
    const prompt = VisibilityContextAssembler.formatPrompt(context);
    expect(prompt).not.toContain('BOB_SECRET');
    expect(prompt).not.toContain('PLAYER_SECRET_PLAN');
    expect(prompt).toContain('ALICE_SCENE');
  });

  it('a turn with no NPCs present is invisible to any NPC scene', () => {
    const turns = [
      turn(0, 'brood alone', [], 'SOLO_SCENE'),
      turn(1, 'meet alice', ['alice'], 'ALICE_SCENE'),
    ];
    const context = assemble({ presentNpcIds: ['alice'], allTurns: turns });
    const outputs = context.filteredHistory.map((h) => h.sceneOutput);
    expect(outputs).not.toContain('SOLO_SCENE');
    expect(outputs).toContain('ALICE_SCENE');
  });

  it('turns with no variants are excluded', () => {
    const turns = [
      { index: 0, playerInput: 'unfinished', variants: [], createdAt: 0 },
      turn(1, 'meet alice', ['alice'], 'ALICE_SCENE'),
    ];
    const context = assemble({ presentNpcIds: ['alice'], allTurns: turns });
    expect(context.filteredHistory).toHaveLength(1);
    expect(context.filteredHistory[0].sceneOutput).toBe('ALICE_SCENE');
  });

  // ---- the retention half of the invariant -----------------------------

  it('turns where a present NPC was present are retained', () => {
    const turns = [
      turn(0, 'first', ['alice'], 'S0'),
      turn(1, 'second', ['alice'], 'S1'),
      turn(2, 'third', ['alice'], 'S2'),
    ];
    const context = assemble({ presentNpcIds: ['alice'], allTurns: turns });
    expect(context.filteredHistory.map((h) => h.sceneOutput)).toEqual(['S0', 'S1', 'S2']);
  });

  it('partial overlap is enough to make a turn visible', () => {
    const turns = [
      turn(0, 'both here', ['alice', 'bob'], 'SHARED'),
      turn(1, 'alice alone', ['alice'], 'ALICE_ONLY'),
    ];
    const context = assemble({ presentNpcIds: ['bob'], allTurns: turns });
    const outputs = context.filteredHistory.map((h) => h.sceneOutput);
    expect(outputs).toContain('SHARED');
    expect(outputs).not.toContain('ALICE_ONLY');
  });

  it('any one of several present NPCs can admit a turn', () => {
    const turns = [
      turn(0, 'alice scene', ['alice'], 'A'),
      turn(1, 'bob scene', ['bob'], 'B'),
      turn(2, 'carol scene', ['carol'], 'C'),
    ];
    const context = assemble({ presentNpcIds: ['alice', 'bob'], allTurns: turns });
    const outputs = context.filteredHistory.map((h) => h.sceneOutput);
    expect(outputs).toContain('A');
    expect(outputs).toContain('B');
    expect(outputs).not.toContain('C');
  });

  it('visibility is judged on the latest variant of a past turn', () => {
    const turnWithReroll: Turn = {
      index: 0,
      playerInput: 'rerolled turn',
      createdAt: 0,
      variants: [
        variantOf({ id: 'old', sceneOutput: 'OLD', presentNpcIds: ['bob'] }),
        variantOf({ id: 'new', sceneOutput: 'NEW', presentNpcIds: ['alice'] }),
      ],
    };
    const context = assemble({ presentNpcIds: ['alice'], allTurns: [turnWithReroll] });
    expect(context.filteredHistory).toHaveLength(1);
    expect(context.filteredHistory[0].sceneOutput).toBe('NEW');
  });

  // ---- solo scenes -----------------------------------------------------

  it('empty present NPCs means a solo scene that sees all turns', () => {
    const turns = [
      turn(0, 'a', ['alice'], 'A'),
      turn(1, 'b', ['bob'], 'B'),
      turn(2, 'c', [], 'C'),
    ];
    const context = assemble({
      presentNpcIds: [],
      allTurns: turns,
      presentNpcs: [],
    });
    expect(context.filteredHistory).toHaveLength(3);
    expect(context.filteredHistory.map((h) => h.sceneOutput)).toEqual(['A', 'B', 'C']);
  });

  it('empty history assembles cleanly', () => {
    const context = assemble({ presentNpcIds: ['alice'], allTurns: [] });
    expect(context.filteredHistory).toHaveLength(0);
  });

  // ---- payload assembly order and content ------------------------------

  it('synopsis is carried verbatim', () => {
    const context = assemble({
      presentNpcIds: [],
      allTurns: [],
      presentNpcs: [],
      synopsis: 'The bridge groans and begins to tilt.',
    });
    expect(context.synopsis).toBe('The bridge groans and begins to tilt.');
    expect(VisibilityContextAssembler.formatPrompt(context)).toContain(
      'The bridge groans and begins to tilt.',
    );
  });

  it('present NPC payload carries sheet agency and trackers', () => {
    const context = assemble({ presentNpcIds: ['alice'], allTurns: [] });
    const payload = context.presentNpcs[0];
    expect(payload.id).toBe('alice');
    expect(payload.description).toBe('desc of NPC alice');
    expect(payload.personality).toBe('personality of NPC alice');
    expect(payload.voiceExamples).toEqual(['A line from NPC alice']);
    expect(payload.agency).toContain('goal-alice');
    expect(payload.agency).toContain('stance-alice');
    expect(payload.trackers).toEqual({ trust: 3 });
  });

  it('formats empty agency as the documented sentinel string', () => {
    const blank = npc('quiet');
    blank.agency = { goal: '', stance: '', will_act_on: '' };
    const context = assemble({ presentNpcIds: ['quiet'], presentNpcs: [blank], allTurns: [] });
    expect(context.presentNpcs[0].agency).toBe('No current agency state.');
    void blank;
  });

  it('prompt sections appear in the documented order', () => {
    // pipeline.md section 5: synopsis, mechanics, NPCs, history, memories,
    // player input. Order is part of the contract.
    const turns = [turn(0, 'past input', ['alice'], 'PAST_SCENE')];
    const context = assemble({
      presentNpcIds: ['alice'],
      allTurns: turns,
      memories: [{ scope: 'campaign', npc_id: null, fact: 'REMEMBERED_FACT', turn: 0, ts: 0 }],
      playerInput: 'CURRENT_INPUT',
    });
    const prompt = VisibilityContextAssembler.formatPrompt(context);
    const synopsisAt = prompt.indexOf('fresh synopsis');
    const npcAt = prompt.indexOf('Present NPCs');
    const historyAt = prompt.indexOf('PAST_SCENE');
    const memoryAt = prompt.indexOf('REMEMBERED_FACT');
    const inputAt = prompt.indexOf('CURRENT_INPUT');
    expect(synopsisAt).toBeGreaterThanOrEqual(0);
    expect(npcAt).toBeGreaterThan(synopsisAt);
    expect(historyAt).toBeGreaterThan(npcAt);
    expect(memoryAt).toBeGreaterThan(historyAt);
    expect(inputAt).toBeGreaterThan(memoryAt);
  });

  it('history preserves chronological order', () => {
    const turns = [
      turn(0, 'first', ['alice'], 'S0'),
      turn(1, 'second', ['alice'], 'S1'),
    ];
    const prompt = VisibilityContextAssembler.formatPrompt(
      assemble({ presentNpcIds: ['alice'], allTurns: turns }),
    );
    expect(prompt.indexOf('S0')).toBeLessThan(prompt.indexOf('S1'));
  });
});

describe('empty playerInput turns (opening scene)', () => {
  it('contributes only sceneOutput to the prompt: no empty player line', () => {
    const opening = turn(0, '', [], 'The harbor lights flicker in the rain.');
    const followUp = turn(1, 'I hail the ferryman.', [], 'He turns, oar half-raised.');
    const npcs: Npc[] = [];
    const context = VisibilityContextAssembler.assemble({
      synopsis: 'beat',
      tension: null,
      location: 'The harbor',
      mechanicResults: [],
      presentNpcIds: [],
      presentNpcs: npcs,
      allTurns: [opening, followUp],
      retrievedMemories: [],
      playerInput: 'I step ashore.',
    });
    const prompt = VisibilityContextAssembler.formatPrompt(context);

    // The opening's prose is present exactly once...
    const count = prompt.split('The harbor lights flicker in the rain.').length - 1;
    expect(count).toBe(1);
    // ...with NO empty Player line right before it (only the follow-up keeps one).
    expect(prompt).not.toContain('**Player:** \n');
    expect(prompt).toContain('**Player:** I hail the ferryman.');
    // The line directly above the opening prose must not be a player cue.
    const lines = prompt.split('\n');
    const idx = lines.findIndex((l) => l.includes('The harbor lights flicker'));
    expect(lines[idx - 1].trim()).not.toBe('**Player:**');
  });
});
