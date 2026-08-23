/**
 * Route tests for the narrative status board endpoints plus prompt-preview
 * support for the 'tracker-update' stage.
 */

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

function validBoard() {
  return {
    dateTime: 'Rabu, 17 Desember, 16:51 WIB',
    location: 'Kamar apartemen Zane, Jakarta',
    atmosphere: 'Malam awal, AC dingin.',
    player: { look: 'Hoodie gelap', condition: 'Napas berat', carrying: 'Ponsel di lantai' },
    npcs: {
      axel: {
        look: 'Jaket oversize peach',
        condition: 'Terengah tapi tenang',
        carrying: '-',
        innerVoice: '"Lepas semua di aku..."',
      },
    },
    updatedAtTurn: 3,
  };
}

async function createCampaign(base: string): Promise<string> {
  const created = await json<{ id: string }>(
    await fetch(`${base}/api/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  return created.id;
}

describe('tracker routes', () => {
  it('GET returns null before generation and the persisted board after PUT (round-trip)', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base);

    const before = await json<{ trackerState: unknown }>(
      await fetch(`${base}/api/campaigns/${campaignId}/tracker`),
    );
    expect(before.trackerState).toBeNull();

    const put = await json<{ ok: boolean; trackerState: unknown }>(
      await fetch(`${base}/api/campaigns/${campaignId}/tracker`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trackerState: validBoard() }),
      }),
    );
    expect(put.ok).toBe(true);

    const after = await json<{ trackerState: typeof validBoard }>(
      await fetch(`${base}/api/campaigns/${campaignId}/tracker`),
    );
    expect(after.trackerState).toEqual(validBoard());

    // Persisted to disk, not just echoed.
    const stored = await h.hub.campaigns.get(campaignId);
    expect(stored?.trackerState).toEqual(validBoard());
  });

  it('PUT rejects garbage shapes with 400', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base);

    // NOTE: express.json strict mode rejects non-object roots with
    // invalid_json, so only object-shaped garbage is tested here.
    for (const garbage of [
      {},
      { trackerState: null },
      { trackerState: { location: 'missing fields' } },
      {
        trackerState: {
          dateTime: 'd',
          location: 'l',
          atmosphere: 'a',
          player: { look: 'x', condition: 5, carrying: 'z' },
          npcs: {},
          updatedAtTurn: null,
        },
      },
      {
        trackerState: {
          dateTime: 'd',
          location: 'l',
          atmosphere: 'a',
          player: null,
          npcs: { bad: { look: 'x', condition: 'y', carrying: 'z', innerVoice: [] } },
          updatedAtTurn: null,
        },
      },
      {
        trackerState: {
          dateTime: 'd',
          location: 'l',
          atmosphere: 'a',
          player: null,
          npcs: [],
          updatedAtTurn: null,
        },
      },
    ]) {
      const res = await fetch(`${base}/api/campaigns/${campaignId}/tracker`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(garbage),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('invalid_tracker_state');
    }
    // Nothing was written by the rejected attempts.
    const after = await json<{ trackerState: unknown }>(
      await fetch(`${base}/api/campaigns/${campaignId}/tracker`),
    );
    expect(after.trackerState).toBeNull();
  });

  it('404s unknown campaigns for GET and PUT', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    expect(
      (await fetch(`${base}/api/campaigns/nope/tracker`)).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${base}/api/campaigns/nope/tracker`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ trackerState: validBoard() }),
        })
      ).status,
    ).toBe(404);
  });

  it('prompt-preview supports the tracker-update stage', async () => {
    const h = await fresh();
    const port = await h.listen();
    const base = `http://127.0.0.1:${port}`;
    const campaignId = await createCampaign(base);

    const preview = await json<{ stage: string; system: string; user: string }>(
      await fetch(`${base}/api/campaigns/${campaignId}/prompt-preview?stage=tracker-update`),
    );
    expect(preview.stage).toBe('tracker-update');
    expect(preview.system).toContain('status board');
    expect(preview.user).toContain('(none yet: this is the first board)');

    // With a persisted board, the preview embeds it as the previous state.
    await fetch(`${base}/api/campaigns/${campaignId}/tracker`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackerState: validBoard() }),
    });
    const second = await json<{ user: string }>(
      await fetch(`${base}/api/campaigns/${campaignId}/prompt-preview?stage=tracker-update`),
    );
    expect(second.user).toContain('"dateTime":"Rabu, 17 Desember, 16:51 WIB"');
  });
});
