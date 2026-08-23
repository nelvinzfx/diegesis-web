import { afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHarness, readSse, type Harness } from './harness.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];

async function fresh(options?: Parameters<typeof createHarness>[0]) {
  const harness = await createHarness(options);
  harnesses.push(harness);
  return harness;
}

afterAll(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

async function makeCampaign(base: string): Promise<string> {
  const res = await fetch(`${base}/api/campaigns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'T', premise: 'P' }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function storedTurns(h: Harness, campaignId: string) {
  return h.hub.turns.list(campaignId);
}

describe('auto title on first turn', () => {
  it('names an Untitled campaign and ships campaignTitle in done', async () => {
    const h = await fresh({
      fakeOptions: { thinkChunks: ['"Senja Berdarah"'] },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const res0 = await fetch(`${base}/api/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', premise: 'P' }),
    });
    const campaignId = ((await res0.json()) as { id: string }).id;

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'I chase her through the crowd.' }),
    });
    const events = await readSse(res);
    const done = events[events.length - 1];
    expect(done.event).toBe('done');
    expect((done.data as { campaignTitle?: string }).campaignTitle).toBe('Senja Berdarah');
    const stored = await h.hub.campaigns.get(campaignId);
    expect(stored?.title).toBe('Senja Berdarah');
  });

  it('does not touch already titled campaigns', async () => {
    const h = await fresh({
      fakeOptions: { thinkChunks: ['"Should Not Appear"'] },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'I push the door open.' }),
    });
    const events = await readSse(res);
    const done = events[events.length - 1] as { event: string; data: Record<string, unknown> };
    expect(done.event).toBe('done');
    expect(done.data['campaignTitle']).toBeUndefined();
    const stored = await h.hub.campaigns.get(campaignId);
    expect(stored?.title).toBe('T');
  });
});

describe('POST /api/campaigns/:id/turns (SSE)', () => {
  it('streams stage/token events in order and persists the turn', async () => {
    const h = await fresh({
      fakeOptions: {
        proseChunks: ['The door ', 'groans open.'],
        reasoningChunks: ['pondering the lock…'],
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'I push the door open.' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await readSse(res);
    const names = events.map((e) => e.event);
    expect(names[names.length - 1]).toBe('done');
    expect(names.filter((n) => n === 'error')).toEqual([]);

    // Stage lifecycle: router opens the pipeline; scene streaming precedes tokens.
    const stageLines = events
      .filter((e) => e.event === 'stage')
      .map((e) => (e.data as { line: string }).line);
    expect(stageLines[0]).toBe('router: deciding checks…');
    expect(stageLines).toContain('plot: generating turn plan…');
    expect(stageLines).toContain('scene: streaming…');
    const firstTokenOverall = names.indexOf('token');
    const stagesBeforeFirstToken = events
      .slice(0, firstTokenOverall)
      .filter((e) => e.event === 'stage').length;
    expect(stagesBeforeFirstToken).toBeGreaterThanOrEqual(3); // router, plot, scene

    // Tokens arrive in order.
    const tokenTexts = events
      .filter((e) => e.event === 'token')
      .map((e) => (e.data as { text: string }).text);
    expect(tokenTexts).toEqual(['The door ', 'groans open.']);

    // Reasoning routed to its own channel, never into tokens.
    const reasoningTexts = events
      .filter((e) => e.event === 'reasoning')
      .map((e) => (e.data as { text: string }).text);
    expect(reasoningTexts).toEqual(['pondering the lock…']);

    // done carries turn + variant.
    const done = events[names.length - 1].data as {
      turn: { index: number; playerInput: string; variants: Array<{ id: string }> };
      variant: { id: string; sceneOutput: string; interrupted: boolean; reasoning: string | null };
    };
    expect(done.turn.index).toBe(0);
    expect(done.turn.playerInput).toBe('I push the door open.');
    expect(done.variant.sceneOutput).toBe('The door groans open.');
    expect(done.variant.interrupted).toBe(false);
    expect(done.variant.reasoning).toBe('pondering the lock…');
    expect(done.turn.variants.map((v) => v.id)).toContain(done.variant.id);

    // Persisted exactly like the Android layout.
    const stored = await storedTurns(h, campaignId);
    expect(stored.length).toBe(1);
    expect(stored[0].variants[0].sceneOutput).toBe('The door groans open.');

    // The fake's structured path was used for router/plot/extraction stages.
    expect(h.fake.structuredCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects an empty playerInput with JSON 400 before any stream starts', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);
    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: string }).error).toBe('player_input_required');
  });

  it('persists a partial interrupted variant when the scene stream dies mid-flight', async () => {
    const h = await fresh({
      fakeOptions: {
        proseChunks: ['partial prose ', 'never delivered'],
        failProseAfterChunks: 1,
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const events = await readSse(
      await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerInput: 'strike the bell' }),
      }),
    );

    const names = events.map((e) => e.event);
    expect(names[names.length - 1]).toBe('done'); // still ends cleanly

    const stageLines = events
      .filter((e) => e.event === 'stage')
      .map((e) => (e.data as { line: string }).line);
    expect(stageLines.some((l) => l.startsWith('scene: interrupted'))).toBe(true);

    const done = events[names.length - 1].data as {
      variant: { sceneOutput: string; interrupted: boolean };
    };
    expect(done.variant.sceneOutput).toBe('partial prose ');
    expect(done.variant.interrupted).toBe(true);

    const stored = await storedTurns(h, campaignId);
    expect(stored[0].variants[0]).toMatchObject({
      sceneOutput: 'partial prose ',
      interrupted: true,
    });
  });

  it('aborts provider calls on client disconnect and still persists partial output', async () => {
    const h = await fresh({
      fakeOptions: {
        proseChunks: ['first chunk '],
        hangProseUntilAbort: true,
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const clientController = new AbortController();
    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'stop me mid-scene' }),
      signal: clientController.signal,
    });

    // Read until the first token arrives, then hang up — like tapping Stop.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('event: token')) break;
    }
    clientController.abort();
    await reader.cancel().catch(() => undefined);

    // The scoped caller must have received an abort signal…
    expect(h.fake.signals.length).toBeGreaterThan(0);
    // …and the pipeline still persisted the interrupted variant.
    const turnsFile = path.join(h.root, 'campaigns', campaignId, 'turns', '000000.json');
    const deadline = Date.now() + 8000;
    let persisted: { variants: Array<{ interrupted: boolean; sceneOutput: string }> } | null = null;
    while (Date.now() < deadline) {
      try {
        const parsed = JSON.parse(await fs.readFile(turnsFile, 'utf8')) as {
          variants: Array<{ interrupted: boolean; sceneOutput: string }>;
        };
        if (parsed.variants.length > 0) {
          persisted = parsed;
          break;
        }
      } catch {
        // not written yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (persisted === null) throw new Error('interrupted variant was never persisted');
    expect(persisted.variants[0]).toMatchObject({ interrupted: true, sceneOutput: 'first chunk ' });
  });

  it('DELETE /turns/:index truncates that turn and later ones', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);
    for (const index of [0, 1, 2]) {
      await h.hub.turns.save(campaignId, {
        index,
        playerInput: `p${index}`,
        variants: [],
        createdAt: 1,
      });
    }
    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns/1`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { removed: number[] }).removed).toEqual([1, 2]);
    const listed = (await (
      await fetch(`${base}/api/campaigns/${campaignId}/turns`)
    ).json()) as { turns: Array<{ index: number }> };
    expect(listed.turns.map((t) => t.index)).toEqual([0]);
  });

  it('PUT /turns/:index edits cue text and variant prose in place', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);
    await h.hub.turns.save(campaignId, {
      index: 0,
      playerInput: 'original action',
      variants: [
        {
          id: 'v0',
          synopsis: 's',
          sceneOutput: 'old prose',
          routerDecision: null,
          presentNpcIds: [],
          mechanicResults: [],
          interrupted: false,
          timestamp: 0,
          stageEvents: [], tension: null,
          reasoning: null,
        },
      ],
      createdAt: 1,
    });
    await h.hub.turns.save(campaignId, {
      index: 1,
      playerInput: 'second action',
      variants: [],
      createdAt: 2,
    });

    const res = await fetch(`${base}/api/campaigns/${campaignId}/turns/0`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'edited action', sceneOutput: 'new prose' }),
    });
    expect(res.status).toBe(200);
    const { turn } = (await res.json()) as {
      turn: { playerInput: string; variants: Array<{ sceneOutput: string }> };
    };
    expect(turn.playerInput).toBe('edited action');
    expect(turn.variants[0].sceneOutput).toBe('new prose');

    // Garbage and unknowns are rejected.
    const empty = await fetch(`${base}/api/campaigns/${campaignId}/turns/0`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
    const missing = await fetch(`${base}/api/campaigns/${campaignId}/turns/9`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'x' }),
    });
    expect(missing.status).toBe(404);
    // Turn 0 (opening) may be blank by design; a real turn may not.
    const blankCue = await fetch(`${base}/api/campaigns/${campaignId}/turns/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: '   ' }),
    });
    expect(blankCue.status).toBe(400);
  });
});

describe('POST /api/campaigns/:id/plan (SSE)', () => {
  it('streams reasoning + prose, then persists sessionPlan', async () => {
    const h = await fresh({
      fakeOptions: {
        thinkChunks: ['# Premise\n', 'Storm season.'],
        reasoningChunks: ['weighing beats…'],
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const res = await fetch(`${base}/api/campaigns/${campaignId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ premise: 'A harbor town under a curse.', title: 'Salt & Debt' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await readSse(res);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('stage');
    expect((events[0].data as { line: string }).line).toBe('plan: drafting…');
    expect(names[names.length - 1]).toBe('done');
    expect(
      events.filter((e) => e.event === 'reasoning').map((e) => (e.data as { text: string }).text),
    ).toEqual(['weighing beats…']);
    const tokens = events
      .filter((e) => e.event === 'token')
      .map((e) => (e.data as { text: string }).text)
      .join('');
    expect(tokens).toBe('# Premise\nStorm season.');

    const done = events[names.length - 1].data as {
      campaign: { sessionPlan: string; premise: string; title: string };
    };
    expect(done.campaign.sessionPlan).toBe('# Premise\nStorm season.');
    expect(done.campaign.premise).toBe('A harbor town under a curse.'); // inline edit applied
    expect(done.campaign.title).toBe('Salt & Debt');

    const stored = await h.hub.campaigns.get(campaignId);
    expect(stored?.sessionPlan).toBe('# Premise\nStorm season.');
  });

  it('keeps a partial plan and reports error when the think stream dies', async () => {
    const h = await fresh({
      fakeOptions: {
        thinkChunks: ['partial plan ', 'never delivered'],
        failThinkAfterChunks: 1,
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await makeCampaign(base);

    const events = await readSse(
      await fetch(`${base}/api/campaigns/${campaignId}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    const names = events.map((e) => e.event);
    expect(names).toContain('error');
    expect(names[names.length - 1]).toBe('done');

    const done = events[names.length - 1].data as { campaign: { sessionPlan: string } };
    expect(done.campaign.sessionPlan).toBe('partial plan ');
    expect((await h.hub.campaigns.get(campaignId))?.sessionPlan).toBe('partial plan ');
  });
});
