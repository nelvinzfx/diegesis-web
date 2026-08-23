import { afterAll, describe, expect, it } from 'vitest';
import { createHarness } from './harness.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];

async function fresh(options?: Parameters<typeof createHarness>[0]) {
  const harness = await createHarness(options);
  harnesses.push(harness);
  return harness;
}

afterAll(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});

async function json<T>(res: globalThis.Response): Promise<T> {
  return (await res.json()) as T;
}

describe('campaign CRUD', () => {
  it('creates with defaults, edits preserving untouched fields, deletes', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const created = await json<{
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      sceneState: { location: string; presentNpcIds: string[] };
      thinkModel: unknown;
    }>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'The Drowned Vault', premise: 'Sunken temple heist.' }),
      }),
    );
    expect(created.title).toBe('The Drowned Vault');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.sceneState).toEqual({ location: '', presentNpcIds: [] });
    expect(created.thinkModel).toBeNull();

    const listed = await json<{ campaigns: Array<{ id: string }> }>(
      await fetch(`${base}/api/campaigns`),
    );
    expect(listed.campaigns.map((c) => c.id)).toContain(created.id);

    // Edit ONLY the title; everything else — id, createdAt, premise — survives.
    const edited = await json<{ title: string; premise: string; createdAt: number; id: string }>(
      await fetch(`${base}/api/campaigns/${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
    );
    expect(edited.title).toBe('Renamed');
    expect(edited.premise).toBe('Sunken temple heist.');
    expect(edited.createdAt).toBe(created.createdAt);
    expect(edited.id).toBe(created.id);

    // Client-supplied id/createdAt cannot hijack identity.
    const hijack = await json<{ id: string; createdAt: number }>(
      await fetch(`${base}/api/campaigns/${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'evil', createdAt: 1, sessionPlan: '# Plan' }),
      }),
    );
    expect(hijack.id).toBe(created.id);
    expect(hijack.createdAt).toBe(created.createdAt);
    expect((await fetch(`${base}/api/campaigns/${created.id}`)).status).toBe(200);

    expect(
      (await fetch(`${base}/api/campaigns/${created.id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await fetch(`${base}/api/campaigns/${created.id}`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/campaigns/${created.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('404s unknown campaigns for every sub-resource', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    for (const path of [
      '/api/campaigns/nope',
      '/api/campaigns/nope/npcs',
      '/api/campaigns/nope/memories',
      '/api/campaigns/nope/turns',
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
    }
    // SSE endpoints also answer JSON 404 before any stream starts.
    const turnRes = await fetch(`${base}/api/campaigns/nope/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerInput: 'hi' }),
    });
    expect(turnRes.status).toBe(404);
    expect(turnRes.headers.get('content-type')).toContain('application/json');
  });
});

describe('npc routes', () => {
  async function campaignWithNpcs() {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaign = await json<{ id: string }>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    return { h, base, campaignId: campaign.id };
  }

  it('creates, lists, updates (preserving sourceCard), deletes', async () => {
    const { h, base, campaignId } = await campaignWithNpcs();

    const npc = await json<{ id: string; name: string; agency: unknown; trackers: unknown }>(
      await fetch(`${base}/api/campaigns/${campaignId}/npcs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Alric',
          description: 'Harbor fixer.',
          trackers: { trust: 2 },
          agency: { goal: 'Pay his debt', stance: 'wary', will_act_on: 'insult' },
        }),
      }),
    );
    expect(npc.name).toBe('Alric');
    expect(npc.trackers).toEqual({ trust: 2 });

    // Seed a sourceCard via direct storage to prove PUT never touches it.
    const stored = await h.hub.npcs.get(campaignId, npc.id);
    await h.hub.npcs.save(campaignId, { ...stored!, sourceCard: 'base64blob' });

    const updated = await json<{ name: string; personality: string; sourceCard: string | null }>(
      await fetch(`${base}/api/campaigns/${campaignId}/npcs/${npc.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alric the Fixer', personality: 'Gruff' }),
      }),
    );
    expect(updated.name).toBe('Alric the Fixer');
    expect(updated.personality).toBe('Gruff');
    expect(updated.sourceCard).toBe('base64blob');

    const listed = await json<{ npcs: Array<{ id: string }> }>(
      await fetch(`${base}/api/campaigns/${campaignId}/npcs`),
    );
    expect(listed.npcs.map((n) => n.id)).toEqual([npc.id]);

    expect(
      (await fetch(`${base}/api/campaigns/${campaignId}/npcs/${npc.id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect((await h.hub.npcs.list(campaignId)).length).toBe(0);
  });

  it('imports a card V2 JSON and rejects garbage', async () => {
    const { h, base, campaignId } = await campaignWithNpcs();

    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Mira',
        description: 'Cartographer of drowned coasts.',
        personality: 'Curious, reckless',
        mes_example: '{{char}}: The tide keeps its own ledger.\n{{user}}: And you keep mine?',
        scenario: 'A dying port city.',
      },
    };
    const imported = await json<{
      name: string;
      description: string;
      personality: string;
      voiceExamples: string[];
      sourceCard: null;
    }>(
      await fetch(`${base}/api/campaigns/${campaignId}/npcs/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: JSON.stringify(card) }),
      }),
    );
    expect(imported.name).toBe('Mira');
    // Engine importer (phase-1 frozen): description comes from data.description.
    expect(imported.description).toBe('Cartographer of drowned coasts.');
    expect(imported.personality).toBe('Curious, reckless');
    expect(imported.voiceExamples.length).toBeGreaterThan(0);
    expect(imported.sourceCard).toBeNull(); // JSON import keeps sourceCard null

    // Persisted on disk like the Android layout.
    const onDisk = await h.hub.npcs.list(campaignId);
    expect(onDisk.map((n) => n.name)).toEqual(['Mira']);

    const badJson = await fetch(`${base}/api/campaigns/${campaignId}/npcs/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: '{not json' }),
    });
    expect(badJson.status).toBe(400);

    const missingField = await fetch(`${base}/api/campaigns/${campaignId}/npcs/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingField.status).toBe(400);

    const badPng = await fetch(`${base}/api/campaigns/${campaignId}/npcs/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from([1, 2, 3, 4]),
    });
    expect(badPng.status).toBe(400);
    expect(((await badPng.json()) as { error: string }).error).toBe('invalid_png');
  });
});

describe('memory + turn listing routes', () => {
  it('lists, deletes one by line index, clears all', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaign = await json<{ id: string }>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    await h.hub.memories.append(campaign.id, {
      scope: 'campaign', npc_id: null, fact: 'first', turn: 1, ts: 1,
    });
    await h.hub.memories.append(campaign.id, {
      scope: 'campaign', npc_id: null, fact: 'second', turn: 2, ts: 2,
    });

    let listed = await json<{ memories: Array<{ fact: string }> }>(
      await fetch(`${base}/api/campaigns/${campaign.id}/memories`),
    );
    expect(listed.memories.map((m) => m.fact)).toEqual(['first', 'second']);

    expect(
      (
        await fetch(`${base}/api/campaigns/${campaign.id}/memories/0`, { method: 'DELETE' })
      ).status,
    ).toBe(200);
    listed = await json(await fetch(`${base}/api/campaigns/${campaign.id}/memories`));
    expect(listed.memories.map((m) => m.fact)).toEqual(['second']);

    expect(
      (
        await fetch(`${base}/api/campaigns/${campaign.id}/memories/99`, { method: 'DELETE' })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${base}/api/campaigns/${campaign.id}/memories/xyz`, { method: 'DELETE' })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/api/campaigns/${campaign.id}/memories`, { method: 'DELETE' })
      ).status,
    ).toBe(200);
    expect(
      ((await json(await fetch(`${base}/api/campaigns/${campaign.id}/memories`))) as {
        memories: unknown[];
      }).memories,
    ).toEqual([]);
  });

  it('lists turns and validates truncation requests', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaign = await json<{ id: string }>(
      await fetch(`${base}/api/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    expect(
      ((await json(await fetch(`${base}/api/campaigns/${campaign.id}/turns`))) as { turns: unknown[] })
        .turns,
    ).toEqual([]);

    expect(
      (
        await fetch(`${base}/api/campaigns/${campaign.id}/turns/notanumber`, { method: 'DELETE' })
      ).status,
    ).toBe(400);
  });
});

describe('settings routes', () => {
  it('never echoes keys back; reports *Set flags instead', async () => {
    const h = await fresh({
      storedSettings: { openaiApiKey: 'sk-super-secret', anthropicApiKey: 'ak-secret' },
    });
    const port = await h.listen();
    const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
    const rawText = await res.text();
    expect(rawText).not.toContain('sk-super-secret');
    expect(rawText).not.toContain('ak-secret');

    const view = JSON.parse(rawText) as {
      openaiApiKey: string;
      anthropicApiKey: string;
      openaiKeySet: boolean;
      anthropicKeySet: boolean;
      provider: string;
      thinkModel: unknown;
      writeModel: unknown;
    };
    expect(view.openaiApiKey).toBe('');
    expect(view.anthropicApiKey).toBe('');
    expect(view.openaiKeySet).toBe(true);
    expect(view.anthropicKeySet).toBe(true);
    expect(view.provider).toBe('openai-compat'); // default overlay applied
    // Flat schema: model fields are plain strings, never objects.
    expect(typeof view.thinkModel).toBe('string');
    expect(typeof view.writeModel).toBe('string');
  });

  it('GET migrates a legacy object-shaped settings.json to the flat view', async () => {
    const h = await fresh({
      storedSettings: {
        thinkModel: { provider: 'openai', model: 'gpt-5-mini' },
        writeModel: { provider: 'anthropic', model: 'claude-opus-4' },
      },
    });
    const port = await h.listen();
    const view = await json<{ provider: string; thinkModel: string; writeModel: string }>(
      await fetch(`http://127.0.0.1:${port}/api/settings`),
    );
    expect(view.provider).toBe('openai-compat'); // 'openai' normalized
    expect(view.thinkModel).toBe('gpt-5-mini');
    expect(view.writeModel).toBe('claude-opus-4');
  });

  it('PUT rejects unknown and empty provider values with 400', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    for (const provider of ['gemini', '', 'OPENAI-COMPAT', 42]) {
      const res = await fetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      expect(res.status).toBe(400);
      const body = await json<{ error: string }>(res);
      expect(body.error).toBe('invalid_provider');
    }
  });

  it('PUT switches provider both ways and scrubs stale legacy keys on save', async () => {
    const h = await fresh({
      storedSettings: {
        thinkModel: { provider: 'openai', model: 'gpt-5-mini' },
        writeModel: { provider: 'anthropic', model: 'claude-opus-4' },
        thinkMaxTokens: 4096, // long-removed key must also be dropped
      },
    });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const toAnthropic = await json<{ provider: string }>(
      await fetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', thinkModel: 'claude-sonnet-4' }),
      }),
    );
    expect(toAnthropic.provider).toBe('anthropic');

    const stored = (await h.hub.settings.load()) as Record<string, unknown>;
    expect(stored['provider']).toBe('anthropic');
    expect(stored['thinkModel']).toBe('claude-sonnet-4'); // string, not object
    expect(stored['writeModel']).toBe('claude-opus-4'); // migrated from legacy object
    expect('thinkMaxTokens' in stored).toBe(false); // stale key scrubbed

    const back = await json<{ provider: string }>(
      await fetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'openai-compat' }),
      }),
    );
    expect(back.provider).toBe('openai-compat');
  });

  it('PUT persists fields and empty-string keys mean "unchanged"', async () => {
    const h = await fresh({ storedSettings: { openaiApiKey: 'existing-key' } });
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;

    const updated = await json<{ language: string; thinkingEffort: string; openaiKeySet: boolean }>(
      await fetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // A client round-tripping the public view sends openaiApiKey: ''.
        body: JSON.stringify({ language: 'Indonesian', thinkingEffort: 'high', openaiApiKey: '' }),
      }),
    );
    expect(updated.language).toBe('Indonesian');
    expect(updated.thinkingEffort).toBe('high');
    expect(updated.openaiKeySet).toBe(true); // existing key survived

    const stored = await h.hub.settings.load();
    expect(stored?.openaiApiKey).toBe('existing-key');
    expect(stored?.language).toBe('Indonesian');
  });

  it('PUT accepts a real key and stores it', async () => {
    const h = await fresh();
    const port = await h.listen();
    const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anthropicApiKey: 'sk-ant-new', openaiBaseUrl: 'https://proxy.example/v1' }),
    });
    expect(res.status).toBe(200);
    const stored = await h.hub.settings.load();
    expect(stored?.anthropicApiKey).toBe('sk-ant-new');
    expect(stored?.openaiBaseUrl).toBe('https://proxy.example/v1');
  });
});
