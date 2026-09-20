import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultAiCaller } from './default-ai-caller.js';
import type { AppSettings } from '../shared/types.js';
import { isMaaSRejection } from './maas-retry.js';

// Mock the openai SDK module: `new OpenAI(opts)` returns a stub client whose
// chat.completions.create is `createMock`.
const { createMock, OpenAIMock } = vi.hoisted(() => {
  const createMock = vi.fn();
  // A real class: vi.fn() wrappers are not constructors in vitest 4, and
  // DefaultAiCaller does `new OpenAI(...)`.
  class OpenAIMock {
    chat = { completions: { create: createMock } };
    constructor(_opts?: unknown) {}
  }
  return { createMock, OpenAIMock };
});

vi.mock('openai', () => ({ default: OpenAIMock }));

function settings(): AppSettings {
  return {
    provider: 'openai-compat',
    thinkModel: 'kimi-k3',
    writeModel: 'kimi-k3',
    openaiBaseUrl: 'https://gateway.example/v1',
    openaiApiKey: 'test-key',
    anthropicApiKey: '',
    language: 'English',
    thinkingEffort: 'medium',
    writeMaxTokens: 512,
    contextWindowTokens: 32768,
  };
}

function maasRejection(): Error {
  return Object.assign(
    new Error(
      'The request is invalid: the request was rejected by an internal MaaS component (system).',
    ),
    { code: '400001', status: undefined },
  );
}

function contentChunk(text: string): unknown {
  return { choices: [{ delta: { content: text } }] };
}

describe('DefaultAiCaller MaaS retry wiring (openai-compat path)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streamProse retries the whole call while nothing was yielded', async () => {
    createMock.mockImplementation(() => {
      const call = createMock.mock.calls.length;
      if (call <= 2) throw maasRejection();
      return (async function* () {
        yield contentChunk('He');
        yield contentChunk('llo');
      })();
    });

    const caller = DefaultAiCaller.create(async () => settings());
    const got: string[] = [];
    for await (const token of caller.streamProse('sys', 'user')) got.push(token);

    expect(got.join('')).toBe('Hello');
    expect(createMock.mock.calls.length).toBe(3);
  });

  it('streamProse does not retry after content passed the guard window', async () => {
    // The refusal guard holds the first ~200 chars before anything reaches the
    // reader; the no-retry rule only binds once text has been flushed. Yield
    // past the window, then fail: the reader has text, so no retry is legal.
    const flushed = 'x'.repeat(250);
    createMock.mockImplementation(() =>
      (async function* () {
        yield contentChunk(flushed);
        throw maasRejection();
      })(),
    );

    const caller = DefaultAiCaller.create(async () => settings());
    const got: string[] = [];
    let caught: unknown;
    try {
      for await (const token of caller.streamProse('sys', 'user')) {
        got.push(token);
      }
    } catch (err) {
      caught = err;
    }

    expect(got.join('')).toBe(flushed);
    expect(isMaaSRejection(caught)).toBe(true);
    expect(createMock.mock.calls.length).toBe(1);
  });

  it('streamProse propagates non-matching errors without retry', async () => {
    const boom = new Error('boom');
    createMock.mockImplementation(() => {
      throw boom;
    });

    const caller = DefaultAiCaller.create(async () => settings());
    let caught: unknown;
    try {
      for await (const _token of caller.streamProse('sys', 'user')) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(boom);
    expect(createMock.mock.calls.length).toBe(1);
  });

  it('completeThink (via generateStructured) retries MaaS rejections', async () => {
    createMock.mockImplementation(() => {
      const call = createMock.mock.calls.length;
      if (call <= 2) throw maasRejection();
      return Promise.resolve({ choices: [{ message: { content: 'PING' } }] });
    });

    const caller = DefaultAiCaller.create(async () => settings());
    const result = await caller.generateStructured<string>(
      'sys',
      'user',
      (raw) => raw,
      'fallback',
    );

    expect(result).toBe('PING');
    expect(createMock.mock.calls.length).toBe(3);
  });
});
