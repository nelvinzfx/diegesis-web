/**
 * Runtime access to effective BYOK settings: reads data/settings.json on every
 * call (cheap, and keeps hand-edits visible), layered over .env bootstrap
 * defaults per server/env.ts precedence.
 *
 * GET responses never include API keys — architecture.md: no key ever ships
 * in an API response. PUT accepts keys but only persists non-empty values,
 * so clients can echo the public view back without wiping secrets.
 */

import type { AppSettings } from '../shared/types.js';
import type { SettingsStorage } from '../storage/settings-storage.js';
import type { EnvProviderDefaults } from './env.js';
import { resolveEffectiveSettings } from './env.js';

export class SettingsService {
  constructor(
    private readonly storage: SettingsStorage,
    private readonly envDefaults: EnvProviderDefaults,
  ) {}

  async get(): Promise<AppSettings> {
    return resolveEffectiveSettings(await this.storage.load(), this.envDefaults);
  }

  /** Merges a patch over the STORED overlay (not the effective view). */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = (await this.storage.load()) ?? {};
    await this.storage.save({ ...stripUnknownKeys(current), ...stripEmptyKeys(patch) });
    return this.get();
  }
}

/** Drops legacy/unknown keys (e.g. the removed thinkMaxTokens) on save. */
function stripUnknownKeys(stored: Record<string, unknown>): Partial<AppSettings> {
  const known: Array<keyof AppSettings> = [
    'thinkModel',
    'writeModel',
    'openaiBaseUrl',
    'openaiApiKey',
    'anthropicApiKey',
    'language',
    'thinkingEffort',
    'writeMaxTokens',
    'contextWindowTokens',
  ];
  const out: Record<string, unknown> = {};
  for (const key of known) {
    if (stored[key] !== undefined) out[key] = stored[key];
  }
  return out as Partial<AppSettings>;
}

/** Empty-string key fields mean "unchanged", never "erase". */
function stripEmptyKeys(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out = { ...patch };
  for (const key of ['openaiApiKey', 'anthropicApiKey'] as const) {
    if (typeof out[key] === 'string' && (out[key] as string).length === 0) {
      delete out[key];
    }
  }
  return out;
}

export interface PublicSettingsView
  extends Omit<AppSettings, 'openaiApiKey' | 'anthropicApiKey'> {
  openaiApiKey: '';
  anthropicApiKey: '';
  openaiKeySet: boolean;
  anthropicKeySet: boolean;
}

export function publicSettingsView(s: AppSettings): PublicSettingsView {
  return {
    ...s,
    openaiApiKey: '',
    anthropicApiKey: '',
    openaiKeySet: s.openaiApiKey.length > 0,
    anthropicKeySet: s.anthropicApiKey.length > 0,
  };
}
