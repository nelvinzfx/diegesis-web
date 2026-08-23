import { describe, expect, it } from 'vitest';
import {
  applyToProcessEnv,
  envProviderDefaults,
  parseDotEnv,
  resolveEffectiveSettings,
} from './env.js';

describe('parseDotEnv', () => {
  it('parses KEY=VALUE, ignores comments and blanks, strips quotes', () => {
    const text = [
      '# comment',
      '',
      'OPENAI_API_KEY=sk-abc',
      'QUOTED="double quoted"',
      "SINGLE='single'",
      'SPACED =  trimmed  ',
      'NO_EQUALS_IGNORED',
    ].join('\n');
    expect(parseDotEnv(text)).toEqual({
      OPENAI_API_KEY: 'sk-abc',
      QUOTED: 'double quoted',
      SINGLE: 'single',
      SPACED: 'trimmed',
    });
  });
});

describe('applyToProcessEnv', () => {
  it('does not clobber existing variables', () => {
    const env: NodeJS.ProcessEnv = { EXISTING: 'keep' };
    applyToProcessEnv({ EXISTING: 'new', FRESH: 'added' }, env);
    expect(env['EXISTING']).toBe('keep');
    expect(env['FRESH']).toBe('added');
  });
});

describe('resolveEffectiveSettings precedence', () => {
  const envDefaults = {
    openaiBaseUrl: 'https://api.unorouter.com/v1',
    openaiApiKey: 'env-key',
    anthropicApiKey: 'env-anthropic',
  };

  it('uses env defaults when settings.json is absent', () => {
    const s = resolveEffectiveSettings(null, envDefaults);
    expect(s.openaiBaseUrl).toBe('https://api.unorouter.com/v1');
    expect(s.openaiApiKey).toBe('env-key');
    expect(s.anthropicApiKey).toBe('env-anthropic');
    expect(s.language).toBe('English'); // untouched default
  });

  it('settings.json keys beat .env keys', () => {
    const s = resolveEffectiveSettings(
      { openaiApiKey: 'file-key', anthropicApiKey: 'file-anthropic' },
      envDefaults,
    );
    expect(s.openaiApiKey).toBe('file-key');
    expect(s.anthropicApiKey).toBe('file-anthropic');
    // Base URL not set in the file → env default still applies.
    expect(s.openaiBaseUrl).toBe('https://api.unorouter.com/v1');
  });

  it('an empty stored key falls back to the env default', () => {
    const s = resolveEffectiveSettings({ openaiApiKey: '' }, envDefaults);
    expect(s.openaiApiKey).toBe('env-key');
  });

  it('falls back to AppSettings defaults when neither layer sets keys', () => {
    const s = resolveEffectiveSettings(null, {
      openaiBaseUrl: null,
      openaiApiKey: null,
      anthropicApiKey: null,
    });
    expect(s.openaiApiKey).toBe('');
    expect(s.openaiBaseUrl).toBe('https://api.openai.com/v1');
    expect(s.thinkMaxTokens).toBe(4096);
  });

  it('overlays non-key fields only when present', () => {
    const s = resolveEffectiveSettings(
      { language: 'Indonesian', thinkMaxTokens: 2048, thinkingEffort: 'high' },
      envDefaults,
    );
    expect(s.language).toBe('Indonesian');
    expect(s.thinkMaxTokens).toBe(2048);
    expect(s.thinkingEffort).toBe('high');
    expect(s.writeMaxTokens).toBe(8192);
  });
});

describe('envProviderDefaults', () => {
  it('maps only non-empty variables', () => {
    expect(
      envProviderDefaults({ OPENAI_API_KEY: 'k', OPENAI_BASE_URL: '', ANTHROPIC_API_KEY: undefined }),
    ).toEqual({ openaiBaseUrl: null, openaiApiKey: 'k', anthropicApiKey: null });
  });
});
