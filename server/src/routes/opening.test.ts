/**
 * Opening scene endpoint tests: turn-0 creation from a stored opening
 * (campaign message, NPC firstMessage fallback, no_opening, regenerate
 * append) and the /opening/generate SSE stream (nothing persisted).
 */

import { afterAll, describe, expect, it } from 'vitest';

import { createHarness, readSse, type Harness } from './harness.js';

const harnesses: Harness[] = [];

async function fresh(options?: Parameters<typeof createHarness>[0]): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

afterAll(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

async function json<T>(res: globalThis.Response): Promise<T> {
  return (await res.json()) as T;
}

async function createCampaign(base: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${base}/api/campaigns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { id: string }).id;
}

async function addPresentNpc(h: Harness, campaignId: string, npc: {
  id: string;
  name: string;
  firstMessage: string;
}): Promise<void> {
  await h.hub.npcs.save(campaignId, {
    id: npc.id,
    name: npc.name,
    description: 'A guide.',
    personality: 'wary',
    firstMessage: npc.firstMessage,
    voiceExamples: [],
    agency: { goal: '', stance: '', will_act_on: '' },
    trackers: {},
    sourceCard: null,
  });
  const campaign = (await h.hub.campaigns.get(campaignId))!;
  await h.hub.campaigns.save({
    ...campaign,
    sceneState: { location: campaign.sceneState.location, presentNpcIds: [npc.id] },
  });
}

describe('POST /api/campaigns/:id/opening', () => {
  it('creates turn 0 from campaign.openingMessage', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, {
      title: 'T',
      premise: 'P',
      openingMessage: 'Rain drums on the harbor stones. The ferry is late.\n\nYou wait.',
    });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { turn } = await json<{
      turn: {
        index: number;
        playerInput: string;
        variants: Array<{ synopsis: string; sceneOutput: string; presentNpcIds: string[] }>;
      };
    }>(res);

    expect(turn.index).toBe(0);
    expect(turn.playerInput).toBe('');
    expect(turn.variants).toHaveLength(1);
    expect(turn.variants[0].sceneOutput).toBe(
      'Rain drums on the harbor stones. The ferry is late.\n\nYou wait.',
    );
    // Synopsis is the first sentence, capped.
    expect(turn.variants[0].synopsis).toBe('Rain drums on the harbor stones.');
    expect(turn.variants[0].presentNpcIds).toEqual([]);

    // Persisted as a real turn file.
    const stored = await h.hub.turns.list(campaignId);
    expect(stored).toHaveLength(1);
    expect(stored[0].playerInput).toBe('');
  });

  it('falls back to the FIRST present NPC firstMessage when openingMessage is empty', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, { title: 'T', premise: 'P' });
    await addPresentNpc(h, campaignId, { id: 'n1', name: 'Lira', firstMessage: 'Kamu lagi dikejar.' });
    await addPresentNpc(h, campaignId, { id: 'n2', name: 'Second', firstMessage: 'wrong one' });
    // addPresentNpc replaces presentNpcIds each call; set both present.
    const campaign = (await h.hub.campaigns.get(campaignId))!;
    await h.hub.campaigns.save({
      ...campaign,
      sceneState: { location: '', presentNpcIds: ['n1', 'n2'] },
    });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { turn } = await json<{
      turn: { variants: Array<{ sceneOutput: string }> };
    }>(res);
    expect(turn.variants[0].sceneOutput).toBe('Kamu lagi dikejar.');
  });

  it('400s with no_opening when neither campaign nor NPC has text', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, { title: 'T', premise: 'P' });
    await addPresentNpc(h, campaignId, { id: 'n1', name: 'Silent', firstMessage: '' });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('no_opening');
    expect(await h.hub.turns.list(campaignId)).toHaveLength(0);
  });

  it('appends a new variant when turn 0 already exists (regenerate semantics)', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, {
      title: 'T',
      premise: 'P',
      openingMessage: 'First opening text.',
    });

    const first = await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });
    expect(first.status).toBe(201);

    // The user edits the opening and replays it.
    const campaign = (await h.hub.campaigns.get(campaignId))!;
    await h.hub.campaigns.save({ ...campaign, openingMessage: 'Second opening text.' });

    const second = await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });
    expect(second.status).toBe(200);
    const { turn } = await json<{
      turn: { index: number; variants: Array<{ sceneOutput: string }> };
    }>(second);
    expect(turn.index).toBe(0);
    expect(turn.variants).toHaveLength(2);
    expect(turn.variants[0].sceneOutput).toBe('First opening text.');
    expect(turn.variants[1].sceneOutput).toBe('Second opening text.');

    const stored = await h.hub.turns.get(campaignId, 0);
    expect(stored?.variants).toHaveLength(2);
  });

  it('404s unknown campaigns', async () => {
    const h = await fresh();
    const port = await h.listen();
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/nope/opening`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/campaigns/:id/opening/generate (SSE)', () => {
  it('streams stage/reasoning/token events, done carries text, nothing is persisted', async () => {
    const h = await fresh({
      fakeOptions: {
        thinkChunks: ['The harbor wakes. ', 'Gulls scream over the masts.'],
        reasoningChunks: ['weighing the first beat…'],
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, {
      title: 'Salt & Debt',
      premise: 'A harbor town under a curse.',
      openingMessage: 'old text that must survive untouched',
    });
    await addPresentNpc(h, campaignId, {
      id: 'n1',
      name: 'Lira',
      firstMessage: 'Kamu lagi dikejar, dan dia senang banget.',
    });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/opening/generate`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await readSse(res);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('stage');
    expect((events[0].data as { line: string }).line).toBe('opening: drafting…');
    expect(
      events.filter((e) => e.event === 'reasoning').map((e) => (e.data as { text: string }).text),
    ).toEqual(['weighing the first beat…']);
    expect(
      events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text),
    ).toEqual(['The harbor wakes. ', 'Gulls scream over the masts.']);
    expect(names[names.length - 1]).toBe('done');

    const done = events[names.length - 1].data as { text: string };
    expect(done.text).toBe('The harbor wakes. Gulls scream over the masts.');

    // NOT persisted: the stored opening is untouched and no turn was created.
    const stored = await h.hub.campaigns.get(campaignId);
    expect(stored?.openingMessage).toBe('old text that must survive untouched');
    expect(await h.hub.turns.list(campaignId)).toHaveLength(0);
  });

  it('reports an error event but still ends with done when the think stream dies', async () => {
    const h = await fresh({
      fakeOptions: {
        thinkChunks: ['partial opening ', 'never delivered'],
        failThinkAfterChunks: 1,
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, { title: 'T', premise: 'P' });

    const events = await readSse(
      await fetch(`${base}/api/campaigns/${campaignId}/opening/generate`, { method: 'POST' }),
    );
    const names = events.map((e) => e.event);
    expect(names).toContain('error');
    expect(names[names.length - 1]).toBe('done');
    const done = events[names.length - 1].data as { text: string };
    expect(done.text).toBe('partial opening ');
  });

  it('404s unknown campaigns before the stream starts', async () => {
    const h = await fresh();
    const port = await h.listen();
    const res = await fetch(`http://127.0.0.1:${port}/api/campaigns/nope/opening/generate`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('turn 0 in the existing turn pipeline', () => {
  it('regenerates turn 0 via POST /turns with empty playerInput + targetTurnIndex 0', async () => {
    const h = await fresh({ fakeOptions: { proseChunks: ['Regenerated opening prose.'] } });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, {
      title: 'T',
      premise: 'P',
      openingMessage: 'Original opening.',
    });

    await fetch(`${base}/api/campaigns/${campaignId}/opening`, { method: 'POST' });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: '', targetTurnIndex: 0 }),
    });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const done = events[events.length - 1];
    expect(done.event).toBe('done');

    const stored = await h.hub.turns.get(campaignId, 0);
    expect(stored?.playerInput).toBe('');
    expect(stored?.variants).toHaveLength(2);
    expect(stored?.variants[1].sceneOutput).toBe('Regenerated opening prose.');
  });

  it('still rejects empty playerInput without targetTurnIndex 0', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base, { title: 'T', premise: 'P' });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('player_input_required');
  });
});
