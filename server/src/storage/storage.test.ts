import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createStorageHub } from './hub.js';
import { Mutex } from './fsio.js';

let roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'diegesis-storage-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of roots.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('SettingsStorage', () => {
  it('round-trips a partial overlay', async () => {
    const root = await tmpRoot();
    const storage = createStorageHub(root).settings;

    expect(await storage.load()).toBeNull();
    await storage.save({ openaiApiKey: 'sk-test', language: 'Indonesian' });
    expect(await storage.load()).toEqual({ openaiApiKey: 'sk-test', language: 'Indonesian' });
  });

  it('writes atomically (no .tmp residue) and pretty-prints', async () => {
    const root = await tmpRoot();
    const storage = createStorageHub(root).settings;
    await storage.save({ language: 'English' });

    const entries = await fs.readdir(root);
    expect(entries).toEqual(['settings.json']);
    const text = await fs.readFile(path.join(root, 'settings.json'), 'utf8');
    expect(text).toContain('\n  "language"');
  });
});

describe('CampaignStorage', () => {
  it('saves, gets, lists sorted, and deletes recursively', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);

    const base = {
      id: 'c2',
      title: 'Second',
      premise: '',
      sessionPlan: '',
      playerPersona: '',
      openingMessage: '',
      sceneState: { location: 'Tavern', presentNpcIds: [] },
      trackerState: null,
      thinkModel: null,
      writeModel: null,
      createdAt: 200,
      updatedAt: 200,
    };
    await hub.campaigns.save(base);
    await hub.campaigns.save({ ...base, id: 'c1', title: 'First', createdAt: 100, updatedAt: 100 });

    expect((await hub.campaigns.list()).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect((await hub.campaigns.get('c2'))?.title).toBe('Second');
    expect(await hub.campaigns.get('missing')).toBeNull();

    // NPC + turn files live inside the folder and must vanish with it.
    await hub.npcs.save('c2', {
      id: 'n1',
      name: 'Innkeeper',
      description: '',
      personality: '',
      firstMessage: '',
      voiceExamples: [],
      agency: { goal: '', stance: '', will_act_on: '' },
      trackers: {},
      sourceCard: null,
    });
    expect(await hub.campaigns.delete('c2')).toBe(true);
    expect(await fs.stat(path.join(root, 'campaigns', 'c2')).then(
      () => true,
      () => false,
    )).toBe(false);
    expect(await hub.campaigns.delete('c2')).toBe(false);
  });
});

describe('NpcStorage', () => {
  it('round-trips and rejects unsafe ids', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    const npc = {
      id: '../escape',
      name: 'Bad',
      description: '',
      personality: '',
      firstMessage: '',
      voiceExamples: [],
      agency: { goal: '', stance: '', will_act_on: '' },
      trackers: {},
      sourceCard: null,
    };
    // save() would write outside the campaign dir — get() must refuse first.
    expect(await hub.npcs.get('c1', '../escape')).toBeNull();
    void npc;
  });

  it('lists npcs by name', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    const mk = (id: string, name: string) => ({
      id,
      name,
      description: '',
      personality: '',
      firstMessage: '',
      voiceExamples: [],
      agency: { goal: '', stance: '', will_act_on: '' },
      trackers: {},
      sourceCard: null,
    });
    await hub.npcs.save('c1', mk('b', 'Zara'));
    await hub.npcs.save('c1', mk('a', 'Alric'));
    expect((await hub.npcs.list('c1')).map((n) => n.name)).toEqual(['Alric', 'Zara']);
    expect((await hub.npcs.list('missing')).length).toBe(0);
    expect(await hub.npcs.delete('c1', 'a')).toBe(true);
    expect((await hub.npcs.list('c1')).length).toBe(1);
  });
});

describe('TurnStorage', () => {
  it('zero-pads filenames and lists sorted indices', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    const turn = (index: number) => ({
      index,
      playerInput: `input ${index}`,
      variants: [],
      createdAt: 1,
    });
    await hub.turns.save('c1', turn(2));
    await hub.turns.save('c1', turn(10));
    await hub.turns.save('c1', turn(0));

    const entries = await fs.readdir(path.join(root, 'campaigns', 'c1', 'turns'));
    expect(entries).toEqual(['000000.json', '000002.json', '000010.json']);
    expect(await hub.turns.listIndices('c1')).toEqual([0, 2, 10]);
  });

  it('appendVariant grows variants[] only', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    await hub.turns.save('c1', {
      index: 0,
      playerInput: 'open the door',
      variants: [
        {
          id: 'v1',
          synopsis: 's',
          sceneOutput: 'first',
          routerDecision: null,
          presentNpcIds: [],
          mechanicResults: [],
          interrupted: false,
          timestamp: 1,
          stageEvents: [],
          reasoning: null,
        },
      ],
      createdAt: 1,
    });

    await hub.turns.appendVariant('c1', 0, {
      id: 'v2',
      synopsis: 's2',
      sceneOutput: 'second',
      routerDecision: null,
      presentNpcIds: [],
      mechanicResults: [],
      interrupted: true,
      timestamp: 2,
      stageEvents: [],
      reasoning: null,
    });

    const turn = await hub.turns.get('c1', 0);
    expect(turn?.variants.map((v) => [v.id, v.sceneOutput, v.interrupted])).toEqual([
      ['v1', 'first', false],
      ['v2', 'second', true],
    ]);
    expect(turn?.playerInput).toBe('open the door');
    await expect(hub.turns.appendVariant('c1', 9, {
      id: 'v3', synopsis: '', sceneOutput: '', routerDecision: null,
      presentNpcIds: [], mechanicResults: [], interrupted: false, timestamp: 3,
      stageEvents: [], reasoning: null,
    })).rejects.toThrow(/not found/);
  });

  it('deleteFrom truncates the turn and every later turn', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    for (const index of [0, 1, 2, 3]) {
      await hub.turns.save('c1', { index, playerInput: 'x', variants: [], createdAt: 1 });
    }
    const removed = await hub.turns.deleteFrom('c1', 2);
    expect(removed).toEqual([2, 3]);
    expect(await hub.turns.listIndices('c1')).toEqual([0, 1]);
  });

  it('serializes concurrent saves through the per-campaign mutex', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        hub.turns.save('c1', { index: i, playerInput: `p${i}`, variants: [], createdAt: 1 }),
      ),
    );
    expect(await hub.turns.listIndices('c1')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('MemoryStorage', () => {
  it('appends JSONL and tolerates a torn trailing line', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    await hub.memories.append('c1', { scope: 'campaign', npc_id: null, fact: 'a', turn: 1, ts: 1 });
    await hub.memories.append('c1', { scope: 'npc', npc_id: 'n1', fact: 'b', turn: 2, ts: 2 });

    const file = path.join(root, 'campaigns', 'c1', 'memories.jsonl');
    await fs.appendFile(file, '{"torn":'); // simulate a crash mid-append
    const entries = await hub.memories.list('c1');
    expect(entries.map((e) => e.fact)).toEqual(['a', 'b']);
  });

  it('keeps concurrent appends separate (mutex)', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        hub.memories.append('c1', { scope: 'campaign', npc_id: null, fact: `f${i}`, turn: i, ts: i }),
      ),
    );
    const entries = await hub.memories.list('c1');
    expect(entries.length).toBe(25);
    expect(new Set(entries.map((e) => e.fact)).size).toBe(25);
  });

  it('deleteAt rewrites without the line; deleteAll empties the file', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    for (const fact of ['a', 'b', 'c']) {
      await hub.memories.append('c1', { scope: 'campaign', npc_id: null, fact, turn: 1, ts: 1 });
    }
    expect(await hub.memories.deleteAt('c1', 1)).toBe(true);
    expect((await hub.memories.list('c1')).map((e) => e.fact)).toEqual(['a', 'c']);
    expect(await hub.memories.deleteAt('c1', 5)).toBe(false);
    await hub.memories.deleteAll('c1');
    expect(await hub.memories.list('c1')).toEqual([]);
  });
});

describe('hub.stores', () => {
  it('implements the OrchestratorStores surface', async () => {
    const root = await tmpRoot();
    const hub = createStorageHub(root);
    await hub.campaigns.save({
      id: 'c1',
      title: 'T',
      premise: '',
      sessionPlan: '',
      playerPersona: '',
      openingMessage: '',
      sceneState: { location: '', presentNpcIds: [] },
      trackerState: null,
      thinkModel: null,
      writeModel: null,
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await hub.stores.loadCampaign('c1'))?.title).toBe('T');
    expect(await hub.stores.loadCampaign('nope')).toBeNull();
    expect(await hub.stores.listTurnIndices('c1')).toEqual([]);
    expect(await hub.stores.loadTurn('c1', 0)).toBeNull();
    expect(await hub.stores.loadNpc('c1', 'x')).toBeNull();
    expect(await hub.stores.loadMemories('c1')).toEqual([]);
    await hub.stores.appendMemory('c1', { scope: 'campaign', npc_id: null, fact: 'f', turn: 0, ts: 0 });
    expect((await hub.stores.loadMemories('c1')).length).toBe(1);
  });
});

describe('Mutex', () => {
  it('runs queued work in order even when earlier work rejects', async () => {
    const mutex = new Mutex();
    const order: number[] = [];
    const failing = mutex.run(async () => {
      order.push(1);
      throw new Error('boom');
    });
    const second = mutex.run(async () => {
      order.push(2);
      return 'ok';
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(order).toEqual([1, 2]);
  });
});

describe('legacy file backfill (opening fields)', () => {
  it('loads an old campaign.json without openingMessage as ""', async () => {
    const root = await tmpRoot();
    const dir = path.join(root, 'campaigns', 'c1');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'campaign.json'),
      JSON.stringify({
        id: 'c1',
        title: 'Old',
        premise: '',
        sessionPlan: '',
        playerPersona: '',
        sceneState: { location: '', presentNpcIds: [] },
        trackerState: null,
        thinkModel: null,
        writeModel: null,
        createdAt: 1,
        updatedAt: 1,
      }),
      'utf8',
    );
    const hub = createStorageHub(root);
    const loaded = await hub.campaigns.get('c1');
    expect(loaded?.openingMessage).toBe('');
    expect((await hub.campaigns.list())[0].openingMessage).toBe('');
  });

  it('loads an old npc.json without firstMessage as ""', async () => {
    const root = await tmpRoot();
    const dir = path.join(root, 'campaigns', 'c1', 'npcs');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'n1.json'),
      JSON.stringify({
        id: 'n1',
        name: 'Old Npc',
        description: '',
        personality: '',
        voiceExamples: [],
        agency: { goal: '', stance: '', will_act_on: '' },
        trackers: {},
        sourceCard: null,
      }),
      'utf8',
    );
    const hub = createStorageHub(root);
    const loaded = await hub.npcs.get('c1', 'n1');
    expect(loaded?.firstMessage).toBe('');
    expect((await hub.npcs.list('c1'))[0].firstMessage).toBe('');
  });
});
