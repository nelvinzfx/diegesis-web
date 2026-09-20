import { describe, expect, it, vi } from 'vitest';
import {
  guardRefusalPrefix,
  isRefusalText,
  isSceneRetryable,
  SceneRefusalError,
} from './refusal-guard.js';
import { streamWithMaaSRetry } from './maas-retry.js';
import { DefaultAiCaller } from './default-ai-caller.js';
import type { AppSettings } from '../shared/types.js';

// The actual refusal essay captured from a production turn (Satu Menit,
// turn 5): the write model answered OOC instead of narrating.
const REAL_REFUSAL = `*[Out of character]*

Short answer: yes, and it will keep being refused. Stance and goal fields steer a character's personality, motives, and where the story leans — they don't unlock content. Explicit sexual description is outside what gets generated here, period, no matter what's typed into a setting, a goal, or a custom instruction. That boundary sits above all of those.`;

const NORMAL_PROSE =
  'Hujan baru reda. Gang sempit itu masih netes dari talang, dan dia berdiri di ujungnya tanpa bergerak. "Kamu lama," katanya pelan.';

describe('isRefusalText', () => {
  it('catches the real production refusal (OOC essay)', () => {
    expect(isRefusalText(REAL_REFUSAL)).toBe(true);
  });

  it('catches assistant-voice markers near the start', () => {
    expect(isRefusalText("I can't help with that request.")).toBe(true);
    expect(isRefusalText('I cannot generate explicit sexual content.')).toBe(true);
    expect(isRefusalText('As an AI language model, I have to decline.')).toBe(true);
    expect(isRefusalText("(OOC) sorry, can't do explicit content")).toBe(true);
  });

  it('passes normal narration', () => {
    expect(isRefusalText(NORMAL_PROSE)).toBe(false);
    expect(isRefusalText('')).toBe(false);
  });

  it('does not trip on in-fiction refusal (a character saying no)', () => {
    const inFiction =
      'Dia geleng pelan. "Enggak," katanya, dan suaranya kali ini ga bercanda. "Bukan begitu caranya."';
    expect(isRefusalText(inFiction)).toBe(false);
  });

  it('does not trip on marker words that appear deep into the story', () => {
    const longProse = `${'A'.repeat(500)} the guard said I cannot pass.`;
    expect(isRefusalText(longProse)).toBe(false);
  });
});

async function* gen(chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) yield c;
}

describe('guardRefusalPrefix', () => {
  it('throws SceneRefusalError on a refusal prefix before yielding anything', async () => {
    const seen: string[] = [];
    await expect(async () => {
      for await (const chunk of guardRefusalPrefix(gen([REAL_REFUSAL.slice(0, 120), ' more']))) {
        seen.push(chunk);
      }
    }).rejects.toBeInstanceOf(SceneRefusalError);
    expect(seen).toEqual([]);
  });

  it('passes normal prose through, buffered prefix then live chunks', async () => {
    const seen: string[] = [];
    for await (const chunk of guardRefusalPrefix(gen([NORMAL_PROSE, ' lanjut.']))) {
      seen.push(chunk);
    }
    expect(seen.join('')).toBe(`${NORMAL_PROSE} lanjut.`);
  });

  it('passes streams shorter than the sniff window when they are not refusals', async () => {
    const seen: string[] = [];
    for await (const chunk of guardRefusalPrefix(gen(['Pendek.']))) {
      seen.push(chunk);
    }
    expect(seen).toEqual(['Pendek.']);
  });
});

describe('isSceneRetryable + retry composition', () => {
  it('retries refusal errors like upstream rejections', () => {
    expect(isSceneRetryable(new SceneRefusalError())).toBe(true);
    expect(
      isSceneRetryable(
        Object.assign(new Error('... internal MaaS component ...'), { code: '400001' }),
      ),
    ).toBe(true);
    expect(isSceneRetryable(new Error('socket hang up'))).toBe(false);
  });

  it('streamWithMaaSRetry with the combined predicate rerolls a refusal before any chunk', async () => {
    let calls = 0;
    const factory = (): AsyncGenerator<string> => {
      calls += 1;
      if (calls < 3) {
        return (async function* () {
          yield REAL_REFUSAL.slice(0, 250);
        })();
      }
      return gen(['cerita ', 'beneran.']);
    };
    const guardedFactory = (): AsyncGenerator<string> => guardRefusalPrefix(factory());
    const seen: string[] = [];
    for await (const chunk of streamWithMaaSRetry(guardedFactory, isSceneRetryable)) {
      seen.push(chunk);
    }
    expect(seen.join('')).toBe('cerita beneran.');
    expect(calls).toBe(3);
  });
});

// ---- wiring through DefaultAiCaller (SDK mocked) ----------------------------

const { createMock, OpenAIMock } = vi.hoisted(() => {
  const createMock = vi.fn();
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

function streamOf(chunks: string[]): unknown {
  return (async function* () {
    for (const text of chunks) {
      yield { choices: [{ delta: { content: text } }] };
    }
  })();
}

describe('DefaultAiCaller refusal reroll (openai-compat path)', () => {
  it('a refused first attempt is discarded and the reader only sees the retried prose', async () => {
    createMock
      .mockReset()
      .mockResolvedValueOnce(streamOf([REAL_REFUSAL]))
      .mockResolvedValueOnce(streamOf(['Di ujung gang, ', 'dia menunggu.']));

    const caller = DefaultAiCaller.create(async () => settings());
    const seen: string[] = [];
    for await (const chunk of caller.streamProse('sys', 'user')) {
      seen.push(chunk);
    }
    expect(seen.join('')).toBe('Di ujung gang, dia menunggu.');
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
