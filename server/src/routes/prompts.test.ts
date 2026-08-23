/**
 * Prompt template API + live preview endpoint tests. Turns are seeded
 * directly through the harness hub so no AI provider is involved.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from './harness.js';
import type { Campaign, Npc, Turn } from '../shared/types.js';

const harnesses: Harness[] = [];

async function fresh(): Promise<Harness> {
  const h = await createHarness();
  harnesses.push(h);
  return h;
}

afterAll(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

async function json<T>(res: globalThis.Response): Promise<T> {
  return (await res.json()) as T;
}

function mkTurn(
  index: number,
  playerInput: string,
  sceneOutput: string,
  npcIds: string[],
  tension: string | null = null,
): Turn {
  return {
    index,
    playerInput,
    variants: [
      {
        id: `variant-${index}`,
        synopsis: `Beat ${index}.`,
        sceneOutput,
        routerDecision: null,
        presentNpcIds: npcIds,
        mechanicResults: [],
        interrupted: false,
        timestamp: 1000 + index,
        stageEvents: [],
        tension,
        reasoning: null,
      },
    ],
    createdAt: 1000 + index,
  };
}

describe('prompt template API', () => {
  it('lists all eight stage keys with defaults and null overrides', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const stages = await json<
      Array<{ key: string; description: string; variables: string[]; default: string; override: string | null }>
    >(await fetch(`${base}/api/prompt-templates`));

    expect(stages.map((s) => s.key)).toEqual([
      'router',
      'plot',
      'agency',
      'scene',
      'memory-extraction',
      'tracker-update',
      'session-plan',
      'title',
      'opening',
    ]);

    // The status-board stage lists exactly its documented template variables.
    const tracker = stages.find((s) => s.key === 'tracker-update');
    expect(tracker?.variables).toEqual([
      'previousTracker',
      'synopsis',
      'sceneOutput',
      'location',
      'presentNpcs',
      'playerPersona',
      'language',
    ]);
    expect(tracker?.default).toContain('status board');

    // The opening stage lists exactly its documented template variables.
    const opening = stages.find((s) => s.key === 'opening');
    expect(opening?.variables).toEqual([
      'title',
      'premise',
      'sessionPlan',
      'location',
      'playerPersona',
      'presentNpcs',
      'language',
    ]);
    expect(opening?.default).toContain('opening scene');
    for (const stage of stages) {
      expect(stage.default.length).toBeGreaterThan(0);
      expect(stage.variables.length).toBeGreaterThan(0);
      expect(stage.override).toBeNull();
    }
  });

  it('PUT saves an override, GET reports it, DELETE resets to default', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const put = await json<{ ok: boolean; override: string | null }>(
      await fetch(`${base}/api/prompt-templates/scene`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template: 'Custom voice {{playerInput}}' }),
      }),
    );
    expect(put.ok).toBe(true);

    let stages = await json<Array<{ key: string; override: string | null }>>(
      await fetch(`${base}/api/prompt-templates`),
    );
    expect(stages.find((s) => s.key === 'scene')?.override).toBe('Custom voice {{playerInput}}');

    // Empty string clears the override.
    await fetch(`${base}/api/prompt-templates/scene`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: '' }),
    });
    stages = await json<Array<{ key: string; override: string | null }>>(
      await fetch(`${base}/api/prompt-templates`),
    );
    expect(stages.find((s) => s.key === 'scene')?.override).toBeNull();

    // Set again then DELETE.
    await fetch(`${base}/api/prompt-templates/scene`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'Again' }),
    });
    const del = await fetch(`${base}/api/prompt-templates/scene`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    stages = await json<Array<{ key: string; override: string | null }>>(
      await fetch(`${base}/api/prompt-templates`),
    );
    expect(stages.find((s) => s.key === 'scene')?.override).toBeNull();
  });

  it('404s unknown stage keys and 400s invalid templates', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    expect(
      (await fetch(`${base}/api/prompt-templates/bogus`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template: 'x' }),
      })).status,
    ).toBe(404);
    expect((await fetch(`${base}/api/prompt-templates/bogus`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await fetch(`${base}/api/prompt-templates/scene`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/api/prompt-templates/scene`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ template: 'x'.repeat(17000) }),
        })
      ).status,
    ).toBe(400);
  });
});

describe('prompt preview endpoint', () => {
  it('previews the scene stage on an empty campaign (shape + override applied)', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const campaign = await json<Campaign>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Preview Camp' }),
      }),
    );

    await fetch(`${base}/api/prompt-templates/scene`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'Override voice for: {{playerInput}}' }),
    });

    const preview = await json<{ stage: string; system: string; user: string; meta: Record<string, unknown> }>(
      await fetch(
        `${base}/api/campaigns/${campaign.id}/prompt-preview?stage=scene&playerInput=${encodeURIComponent('I light a torch.')}`,
      ),
    );
    expect(preview.stage).toBe('scene');
    expect(preview.system).toBe('Override voice for: I light a torch.');
    expect(preview.user).toContain('## Player Action');
    expect(preview.user).toContain('I light a torch.');
    expect(preview.meta['turnsIncluded']).toBe(0);
    expect(preview.meta['turnsDropped']).toBe(0);
    expect(Array.isArray(preview.meta['presentNpcs'])).toBe(true);
  });

  it('applies visibility filtering and trimming with real meta counts', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const campaign = await json<Campaign>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Trim Camp',
          sceneState: { location: 'Vault', presentNpcIds: ['npc-lira'] },
        }),
      }),
    );

    const lira: Npc = {
      id: 'npc-lira',
      name: 'Lira',
      description: 'A guide.',
      personality: 'wary',
      firstMessage: '',
      voiceExamples: [],
      agency: { goal: '', stance: '', will_act_on: '' },
      trackers: {},
      sourceCard: null,
    };
    await h.hub.npcs.save(campaign.id, lira);

    // Three big turns so the oldest exceeds the history budget (default:
    // (32768-8192)*0.8 tokens ≈ 78k chars).
    const filler = 'x'.repeat(40000);
    await h.hub.turns.save(campaign.id, mkTurn(0, 'First step.', `${filler}OLDEST-MARKER`, ['npc-lira']));
    await h.hub.turns.save(campaign.id, mkTurn(1, 'Second step.', filler, ['npc-lira']));
    await h.hub.turns.save(campaign.id, mkTurn(2, 'Third step.', filler, []));

    const preview = await json<{
      system: string;
      user: string;
      meta: { turnsIncluded: number; turnsDropped: number; presentNpcs: string[] };
    }>(await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=scene`));

    // Default sample player input is used when none is given.
    expect(preview.user).toContain('I search the room for clues.');
    expect(preview.meta.turnsIncluded).toBeLessThan(3);
    expect(preview.meta.turnsDropped).toBeGreaterThan(0);
    expect(preview.user).not.toContain('OLDEST-MARKER');
    expect(preview.system).toContain('You are the narrator of a tabletop campaign');
  });

  it('previews the plot stage with real tension history from stored variants', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const campaign = await json<Campaign>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Tension Camp' }),
      }),
    );

    await h.hub.turns.save(campaign.id, mkTurn(0, 'Open the door.', 'It creaks.', [], 'escalate'));
    await h.hub.turns.save(campaign.id, mkTurn(1, 'Sit down.', 'You rest.', [], null));
    await h.hub.turns.save(campaign.id, mkTurn(2, 'Look around.', 'All clear.', [], 'release'));

    const preview = await json<{ system: string; user: string }>(
      await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=plot`),
    );

    expect(preview.user).toContain('## Recent tension');
    expect(preview.user).toContain('- turn 0: escalate');
    expect(preview.user).toContain('- turn 2: release');
    expect(preview.user).not.toContain('turn 1:');
    expect(preview.user.indexOf('turn 0:')).toBeLessThan(preview.user.indexOf('turn 2:'));
    // The parse contract rides the user payload.
    expect(preview.user).toContain('Reply with JSON:');
    expect(preview.user).toContain('"tension"');

    // The registry lists the new template variables.
    const stages = await json<
      Array<{ key: string; variables: string[] }>
    >(await fetch(`${base}/api/prompt-templates`));
    expect(stages.find((s) => s.key === 'plot')?.variables).toEqual([
      'sessionPlan',
      'storySoFar',
      'tensionHistory',
    ]);
    expect(stages.find((s) => s.key === 'scene')?.variables).toEqual([
      'playerInput',
      'synopsis',
      'tension',
      'location',
      'presentNpcs',
    ]);
  });

  it('previews non-scene stages and rejects bad requests', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const campaign = await json<Campaign>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Misc', premise: 'Premise here.' }),
      }),
    );

    const plot = await json<{ stage: string; system: string; user: string }>(
      await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=plot`),
    );
    expect(plot.stage).toBe('plot');
    expect(plot.system).toContain('You are the plot engine');
    expect(plot.user).toContain('Player action:');

    const plan = await json<{ system: string }>(
      await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=session-plan`),
    );
    expect(plan.system).toContain('session-planning assistant');

    const title = await json<{ system: string; user: string }>(
      await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=title`),
    );
    expect(title.system).toContain('You title stories');
    expect(title.user).toContain('Title (max 40 chars)');

    expect(
      (await fetch(`${base}/api/campaigns/${campaign.id}/prompt-preview?stage=bogus`)).status,
    ).toBe(404);
    expect((await fetch(`${base}/api/campaigns/nope/prompt-preview?stage=scene`)).status).toBe(404);
  });
});
