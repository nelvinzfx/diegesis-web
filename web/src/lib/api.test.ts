/**
 * Unit tests for the phase 4 api wrappers: settings payload shaping (empty
 * key fields must be omitted so stored keys survive) and npc import bodies
 * (JSON field vs raw PNG bytes).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSettingsPayload,
  clearMemories,
  deleteMemoryAt,
  getTracker,
  importNpcJson,
  importNpcPngBytes,
  playOpening,
  streamOpening,
  updateSettings,
  updateTracker,
} from './api';
import type { TrackerState } from './types';

// Safe minimal PNG signature for body-shape assertions.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('buildSettingsPayload', () => {
  const base = {
    provider: 'openai-compat' as const,
    openaiBaseUrl: 'https://api.example.com/v1',
    openaiApiKey: '',
    anthropicApiKey: '',
    thinkModel: 'gpt-4o-mini',
    writeModel: 'gpt-4o',
    language: 'English',
    thinkingEffort: 'high',
    writeMaxTokens: 2048,
    contextWindowTokens: 32768,
  };

  it('omits empty key fields entirely', () => {
    const payload = buildSettingsPayload(base);
    expect(payload).not.toHaveProperty('openaiApiKey');
    expect(payload).not.toHaveProperty('anthropicApiKey');
    expect(payload['openaiBaseUrl']).toBe('https://api.example.com/v1');
    expect(payload['thinkingEffort']).toBe('high');
  });

  it('sends the flat provider-first schema: provider + string models', () => {
    const payload = buildSettingsPayload(base);
    expect(payload['provider']).toBe('openai-compat');
    expect(payload['thinkModel']).toBe('gpt-4o-mini');
    expect(payload['writeModel']).toBe('gpt-4o');

    const anthropic = buildSettingsPayload({ ...base, provider: 'anthropic' as const });
    expect(anthropic['provider']).toBe('anthropic');
  });

  it('includes keys that were typed', () => {
    const payload = buildSettingsPayload({
      ...base,
      openaiApiKey: 'sk-new-key',
      anthropicApiKey: 'sk-ant-new',
    });
    expect(payload['openaiApiKey']).toBe('sk-new-key');
    expect(payload['anthropicApiKey']).toBe('sk-ant-new');
  });

  it('treats whitespace-only keys as unchanged (omitted)', () => {
    // The form trims nothing itself; the contract is length > 0 means "send".
    const payload = buildSettingsPayload({ ...base, openaiApiKey: '' });
    expect(Object.keys(payload)).not.toContain('openaiApiKey');
  });
});

describe('settings + memory requests', () => {
  it('updateSettings PUTs JSON to /api/settings', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ language: 'English' }));
    await updateSettings({ language: 'English' } as Parameters<typeof updateSettings>[0]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ language: 'English' });
  });

  it('deleteMemoryAt DELETEs the line index path and resolves void', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(deleteMemoryAt('c1', 3)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/memories/3');
    expect(init.method).toBe('DELETE');
  });

  it('clearMemories DELETEs the collection path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await clearMemories('c1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/memories');
    expect(init.method).toBe('DELETE');
  });
});

describe('npc import', () => {
  it('importNpcJson sends the { json } field as application/json', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'n1' }));
    const card = '{"name":"Maren"}';
    const npc = await importNpcJson('c1', card);
    expect(npc).toEqual({ id: 'n1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/npcs/import');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(JSON.parse(init.body as string)).toEqual({ json: card });
  });

  it('importNpcPngBytes sends raw bytes with content-type image/png', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'n2' }));
    const npc = await importNpcPngBytes('c1', PNG_BYTES);
    expect(npc).toEqual({ id: 'n2' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/npcs/import');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((init.body as Uint8Array)[0]).toBe(0x89);
  });

  it('throws ApiError with the server error code on non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'card_import_failed', message: 'no chara chunk' }),
    } as unknown as Response);
    await expect(importNpcJson('c1', '{}')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'card_import_failed',
    });
  });
});

// ---- opening endpoints -------------------------------------------------------

/** Minimal SSE-shaped Response: frames delivered one read() at a time. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    get body(): ReadableStream<Uint8Array> | null {
      return {
        getReader() {
          return {
            read: async () =>
              i < frames.length
                ? { done: false, value: encoder.encode(frames[i++]) }
                : { done: true, value: undefined },
          };
        },
      } as unknown as ReadableStream<Uint8Array>;
    },
  } as unknown as Response;
}

describe('opening endpoints', () => {
  it('playOpening POSTs to /campaigns/:id/opening and unwraps {turn}', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ turn: { index: 0, playerInput: '' } }));
    const turn = await playOpening('c1');
    expect(turn).toEqual({ index: 0, playerInput: '' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/opening');
    expect(init.method).toBe('POST');
  });

  it('streamOpening POSTs to /opening/generate, dispatches events, surfaces done text', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'event: stage\ndata: {"line":"opening: drafting…"}\n\n',
        'event: reasoning\ndata: {"text":"weighing the first beat…"}\n\n',
        'event: token\ndata: {"text":"The harbor wakes. "}\n\n',
        'event: token\ndata: {"text":"Gulls scream."}\n\n',
        'event: done\ndata: {"text":"The harbor wakes. Gulls scream."}\n\n',
      ]),
    );

    const stages: string[] = [];
    const reasoning: string[] = [];
    const tokens: string[] = [];
    const result = await streamOpening(
      'c1',
      {
        onStage: (line) => stages.push(line),
        onReasoning: (text) => reasoning.push(text),
        onToken: (text) => tokens.push(text),
      },
      undefined,
    );

    expect(stages).toEqual(['opening: drafting…']);
    expect(reasoning).toEqual(['weighing the first beat…']);
    expect(tokens).toEqual(['The harbor wakes. ', 'Gulls scream.']);
    expect(result.aborted).toBe(false);
    expect(result.terminal?.event).toBe('done');
    expect(result.text).toBe('The harbor wakes. Gulls scream.');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/opening/generate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('streamOpening returns null text when no done event arrives', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['event: error\ndata: {"message":"boom"}\n\n']),
    );
    const result = await streamOpening('c1', {
      onStage: () => undefined,
      onReasoning: () => undefined,
      onToken: () => undefined,
    });
    expect(result.text).toBeNull();
    expect(result.terminal?.event).toBe('error');
  });
});
describe('tracker endpoints', () => {
  const board: TrackerState = {
    dateTime: 'Rabu, 17 Desember, 16:51 WIB',
    location: 'Kamar apartemen Zane, Jakarta',
    atmosphere: 'Malam awal, AC dingin.',
    player: { look: 'Hoodie gelap', condition: 'Napas berat', carrying: '-' },
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

  it('getTracker unwraps trackerState (null when never generated)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trackerState: null }));
    await expect(getTracker('c1')).resolves.toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ trackerState: board }));
    await expect(getTracker('c1')).resolves.toEqual(board);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/tracker');
  });

  it('updateTracker PUTs the full board and returns the persisted one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, trackerState: board }));
    await expect(updateTracker('c1', board)).resolves.toEqual(board);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/campaigns/c1/tracker');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ trackerState: board });
  });

  it('updateTracker surfaces ApiError on 400 garbage rejection', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_tracker_state' }),
    } as unknown as Response);
    await expect(updateTracker('c1', board)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'invalid_tracker_state',
    });
  });
});
