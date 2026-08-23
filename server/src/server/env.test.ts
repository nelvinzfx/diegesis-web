import { describe, expect, it } from 'vitest';
import {
  applyToProcessEnv,
  envProviderDefaults,
  migrateStoredSettings,
  parseDotEnv,
  resolveEffectiveSettings,
} from './env.js';
import type { AppSettings } from '../shared/types.js';

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
    expect(s.writeMaxTokens).toBe(8192);
  });

  it('overlays non-key fields only when present', () => {
    const s = resolveEffectiveSettings(
      { language: 'Indonesian', thinkingEffort: 'high' },
      envDefaults,
    );
    expect(s.language).toBe('Indonesian');
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

describe('legacy settings.json migration', () => {
  const noEnv = { openaiBaseUrl: null, openaiApiKey: null, anthropicApiKey: null };

  it('maps legacy {provider, model} objects onto the flat schema', () => {
    const legacy = {
      thinkModel: { provider: 'openai', model: 'gpt-5-mini' },
      writeModel: { provider: 'anthropic', model: 'claude-opus-4' },
      openaiApiKey: 'sk-old',
    } as unknown as Partial<AppSettings>;
    const s = resolveEffectiveSettings(legacy, noEnv);
    // provider derives from the legacy thinkModel; 'openai' normalizes.
    expect(s.provider).toBe('openai-compat');
    expect(s.thinkModel).toBe('gpt-5-mini');
    expect(s.writeModel).toBe('claude-opus-4');
    expect(s.openaiApiKey).toBe('sk-old');
  });

  it("derives 'anthropic' when the legacy think provider was anthropic", () => {
    const legacy = {
      thinkModel: { provider: 'anthropic', model: 'claude-sonnet-4' },
      writeModel: { provider: 'anthropic', model: 'claude-opus-4' },
    } as unknown as Partial<AppSettings>;
    const s = resolveEffectiveSettings(legacy, noEnv);
    expect(s.provider).toBe('anthropic');
    expect(s.thinkModel).toBe('claude-sonnet-4');
  });

  it('normalizes any non-anthropic legacy provider to openai-compat', () => {
    const legacy = {
      thinkModel: { provider: 'weird-gateway', model: 'm1' },
    } as unknown as Partial<AppSettings>;
    const s = resolveEffectiveSettings(legacy, noEnv);
    expect(s.provider).toBe('openai-compat');
    expect(s.thinkModel).toBe('m1');
  });

  it('tolerates garbage model shapes without crashing (defaults apply)', () => {
    const garbage = {
      thinkModel: 42,
      writeModel: { nested: true },
    } as unknown as Partial<AppSettings>;
    const s = resolveEffectiveSettings(garbage, noEnv);
    expect(s.provider).toBe('openai-compat');
    expect(s.thinkModel).toBe('gpt-4o-mini');
    expect(s.writeModel).toBe('gpt-4o');
  });

  it('passes already-flat records through unchanged', () => {
    const flat: Partial<AppSettings> = {
      provider: 'anthropic',
      thinkModel: 'claude-sonnet-4',
      writeModel: 'claude-opus-4',
    };
    expect(migrateStoredSettings(flat as Record<string, unknown>)).toEqual(flat);
    const s = resolveEffectiveSettings(flat, noEnv);
    expect(s.provider).toBe('anthropic');
    expect(s.writeModel).toBe('claude-opus-4');
  });
});

describe('.env-driven provider bootstrap', () => {
  it("defaults to 'anthropic' when only ANTHROPIC_API_KEY is set", () => {
    const s = resolveEffectiveSettings(null, {
      openaiBaseUrl: null,
      openaiApiKey: null,
      anthropicApiKey: 'ak',
    });
    expect(s.provider).toBe('anthropic');
  });

  it("defaults to 'openai-compat' when only OPENAI_* is set", () => {
    const s = resolveEffectiveSettings(null, {
      openaiBaseUrl: 'https://gw.example/v1',
      openaiApiKey: 'ok',
      anthropicApiKey: null,
    });
    expect(s.provider).toBe('openai-compat');
  });

  it("keeps 'openai-compat' when both providers are set in .env", () => {
    const s = resolveEffectiveSettings(null, {
      openaiBaseUrl: null,
      openaiApiKey: 'ok',
      anthropicApiKey: 'ak',
    });
    expect(s.provider).toBe('openai-compat');
  });

  it('stored provider always beats the .env-derived default', () => {
    const s = resolveEffectiveSettings(
      { provider: 'openai-compat' },
      { openaiBaseUrl: null, openaiApiKey: null, anthropicApiKey: 'ak' },
    );
    expect(s.provider).toBe('openai-compat');
  });
});
