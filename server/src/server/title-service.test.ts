import { describe, expect, it } from 'vitest';
import { cleanTitle, isAutoTitleDue, maybeGenerateTitle } from './title-service.js';
import type { AiCaller } from '../engine/ai-caller.js';
import type { AppSettings, Campaign, Turn } from '../shared/types.js';

function campaign(title: string): Campaign {
  return {
    id: 'c1',
    title,
    premise: 'p',
    sessionPlan: '',
    playerPersona: '',
    sceneState: { location: '', presentNpcIds: [] },
    thinkModel: null,
    writeModel: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function turn(): Turn {
  return {
    index: 0,
    playerInput: 'I chase her through the crowd.',
    createdAt: 0,
    variants: [
      {
        id: 'v1',
        synopsis: 'A chase through Kota Tua.',
        sceneOutput: 'text',
        routerDecision: null,
        presentNpcIds: [],
        mechanicResults: [],
        interrupted: false,
        timestamp: 0,
        stageEvents: [],
        reasoning: null,
      },
    ],
  };
}

const settings: AppSettings = {
  openaiBaseUrl: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  thinkModel: { provider: 'openai', model: 'm' },
  writeModel: { provider: 'openai', model: 'm' },
  language: 'Bahasa Indonesia',
  thinkingEffort: 'medium',
  writeMaxTokens: 8192,
  contextWindowTokens: 32768,
};

function callerWith(reply: string): AiCaller {
  return {
    async *streamThink() {
      yield reply;
    },
  } as unknown as AiCaller;
}

describe('cleanTitle', () => {
  it('strips wrapping quotes and trailing punctuation', () => {
    expect(cleanTitle('"Senja Berdarah".')).toBe('Senja Berdarah');
    expect(cleanTitle('“Kejar di Kota Tua”')).toBe('Kejar di Kota Tua');
  });

  it('collapses whitespace and takes the first line only', () => {
    expect(cleanTitle('  Senja   Berdarah\nsecond line ignored  ')).toBe('Senja Berdarah');
  });

  it('caps at 40 chars on a word boundary', () => {
    const out = cleanTitle('Sebuah pengejaran panjang melewati seluruh kota tua yang ramai sekali');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith(' ')).toBe(false);
  });

  it('falls back to a hard cut when the first word is huge', () => {
    const out = cleanTitle('x'.repeat(80));
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('empty garbage yields empty', () => {
    expect(cleanTitle('""  \n  ')).toBe('');
  });
});

describe('maybeGenerateTitle', () => {
  it('skips campaigns that already have a real title', async () => {
    const out = await maybeGenerateTitle({
      caller: callerWith('ignored'),
      settings,
      campaign: campaign('Senja Jakarta'),
      turn: turn(),
    });
    expect(out).toBeNull();
  });

  it('generates for Untitled campaigns and cleans the reply', async () => {
    const out = await maybeGenerateTitle({
      caller: callerWith('"Senja Berdarah"\n'),
      settings,
      campaign: campaign('Untitled'),
      turn: turn(),
    });
    expect(out).toBe('Senja Berdarah');
  });

  it('returns null when the model replies with nothing usable', async () => {
    const out = await maybeGenerateTitle({
      caller: callerWith('   '),
      settings,
      campaign: campaign(''),
      turn: turn(),
    });
    expect(out).toBeNull();
  });

  it('returns null without a persisted turn', async () => {
    const out = await maybeGenerateTitle({
      caller: callerWith('A Title'),
      settings,
      campaign: campaign('Untitled'),
      turn: null,
    });
    expect(out).toBeNull();
  });

  it('swallows caller failures', async () => {
    const boom: AiCaller = {
      async *streamThink(): AsyncGenerator<string> {
        throw new Error('provider down');
      },
    } as unknown as AiCaller;
    const out = await maybeGenerateTitle({
      caller: boom,
      settings,
      campaign: campaign('Untitled'),
      turn: turn(),
    });
    expect(out).toBeNull();
  });
});

describe('isAutoTitleDue', () => {
  it('flags blank and Untitled only', () => {
    expect(isAutoTitleDue(campaign(''))).toBe(true);
    expect(isAutoTitleDue(campaign(' Untitled '))).toBe(true);
    expect(isAutoTitleDue(campaign('Named'))).toBe(false);
  });
});
