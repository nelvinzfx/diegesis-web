import { describe, expect, it } from 'vitest';
import {
  MISSING_KEY_MESSAGE,
  RETRY_NUDGE,
  languageDirective,
  sanitize,
  sceneLanguageDirective,
  structuredWithRetry,
} from './ai-caller.js';
import type { ChatMessage } from './ai-caller.js';

describe('sanitize (fence stripper)', () => {
  it('passes plain JSON through untouched', () => {
    expect(sanitize('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a ```json fence', () => {
    expect(sanitize('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare ``` fence', () => {
    expect(sanitize('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a JSON-marked uppercase fence', () => {
    expect(sanitize('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('trims leading prose before an unclosed-fenced object', () => {
    expect(sanitize('Here you go:\n{"a":1} hope this helps!')).toBe('{"a":1}');
  });

  it('trims prose around a fenced array', () => {
    expect(sanitize('Sure!\n[{"a":1}] done.')).toBe('[{"a":1}]');
  });

  it('keeps a JSON body that never had a wrapper', () => {
    expect(sanitize('  {"nested":{"deep":true}}  ')).toBe('{"nested":{"deep":true}}');
  });

  it('leaves non-json text without braces alone', () => {
    expect(sanitize('plain words only')).toBe('plain words only');
  });
});

describe('structuredWithRetry (one retry then fallback)', () => {
  const system = 'system prompt';
  const user = 'user prompt';

  function okDecoder(raw: string): { value: number } {
    const parsed = JSON.parse(raw) as { value: number };
    if (typeof parsed.value !== 'number') throw new Error('bad shape');
    return parsed;
  }

  it('returns the decoded first attempt on success', async () => {
    const calls: ChatMessage[][] = [];
    const result = await structuredWithRetry(
      system,
      user,
      async (messages) => {
        calls.push([...messages]);
        return '{"value": 1}';
      },
      okDecoder,
      { value: -1 },
    );
    expect(result).toEqual({ value: 1 });
    expect(calls).toHaveLength(1);
  });

  it('retries once with the nudge and assistant echo on bad output', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const result = await structuredWithRetry(
      system,
      user,
      async (messages) => {
        calls.push([...messages]);
        attempt++;
        return attempt === 1 ? 'garbage prose' : '{"value": 2}';
      },
      okDecoder,
      { value: -1 },
    );
    expect(result).toEqual({ value: 2 });
    expect(calls).toHaveLength(2);
    // The retry carries the original messages plus echo + nudge.
    expect(calls[1]).toHaveLength(4);
    expect(calls[1][2]).toMatchObject({ role: 'assistant', content: 'garbage prose' });
    expect(calls[1][3]).toMatchObject({ role: 'user', content: RETRY_NUDGE });
  });

  it('falls back after two failed decodes', async () => {
    let attempts = 0;
    const result = await structuredWithRetry(
      system,
      user,
      async () => {
        attempts++;
        return 'still garbage';
      },
      okDecoder,
      { value: -1 },
    );
    expect(attempts).toBe(2);
    expect(result).toEqual({ value: -1 });
  });

  it('falls back immediately when both transports fail', async () => {
    let attempts = 0;
    const result = await structuredWithRetry(
      system,
      user,
      async () => {
        attempts++;
        throw new Error('network down');
      },
      okDecoder,
      { value: -1 },
    );
    expect(attempts).toBe(2);
    expect(result).toEqual({ value: -1 });
  });

  it('sanitizes a fenced response before decoding so no retry is burned', async () => {
    let attempts = 0;
    const result = await structuredWithRetry(
      system,
      user,
      async () => {
        attempts++;
        return '```json\n{"value": 7}\n```';
      },
      okDecoder,
      { value: -1 },
    );
    expect(attempts).toBe(1);
    expect(result).toEqual({ value: 7 });
  });

  it('echoes an empty string when the first transport failed', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    await structuredWithRetry(
      system,
      user,
      async (messages) => {
        calls.push([...messages]);
        if (attempt++ === 0) return null; // transport failure
        return '{"value": 3}';
      },
      okDecoder,
      { value: -1 },
    );
    expect(calls[1][2]).toMatchObject({ role: 'assistant', content: '' });
  });

  it('exports the exact retry nudge wording', () => {
    expect(RETRY_NUDGE).toBe('Return valid JSON only, no prose.');
  });
});

describe('language directives', () => {
  it('appends the think-stage language directive verbatim', () => {
    const out = languageDirective('Be terse.', 'Indonesian');
    expect(out).toBe(
      'Be terse.\n\nIMPORTANT: Write all narration, dialogue, and prose in Indonesian, ' +
        'regardless of the language of any character sheets or source material.',
    );
  });

  it('appends the scene-stage directive verbatim', () => {
    const out = sceneLanguageDirective('Narrate.', 'English');
    expect(out).toContain('IMPORTANT: Write all narration and prose in English.');
    expect(out).toContain("honor each character's background");
    expect(out).toContain('an American character speaks English');
  });

  it('is a no-op for a blank language', () => {
    expect(languageDirective('Keep.', '')).toBe('Keep.');
    expect(sceneLanguageDirective('Keep.', '')).toBe('Keep.');
  });

  it('trims trailing whitespace before appending', () => {
    const out = languageDirective('Prompt.   \n', 'French');
    expect(out.startsWith('Prompt.\n\nIMPORTANT:')).toBe(true);
  });

  it('exports the missing key message', () => {
    expect(MISSING_KEY_MESSAGE).toBe('Set your API key in Settings first.');
  });
});

describe('thinkRequestExtras (temperature drop rule)', () => {
  it('drops temperature on anthropic when thinking is attached', async () => {
    const { thinkRequestExtras } = await import('./ai-caller.js');
    const extras = thinkRequestExtras(
      { thinkingEffort: 'xhigh', thinkMaxTokens: 8192 },
      'anthropic',
      0.3,
    );
    expect(extras.temperature).toBeNull();
    expect(extras.customBody).toEqual([{ key: 'thinking', value: { type: 'enabled', budget_tokens: 7168 } }]);
  });

  it('keeps temperature on openai-compat and attaches reasoning_effort', async () => {
    const { thinkRequestExtras } = await import('./ai-caller.js');
    const extras = thinkRequestExtras(
      { thinkingEffort: 'high', thinkMaxTokens: 4096 },
      'openai-compat',
      0.3,
    );
    expect(extras.temperature).toBe(0.3);
    expect(extras.customBody).toEqual([{ key: 'reasoning_effort', value: 'high' }]);
  });
});
