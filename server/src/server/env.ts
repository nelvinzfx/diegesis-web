/**
 * dotenv-style .env loading (manual parse — no dependency) plus the
 * settings-precedence rule: defaults < server/.env bootstrap keys <
 * data/settings.json (settings.json always wins once a value is set).
 */

import { readFileSync } from 'node:fs';
import type { AppSettings, SettingsProvider } from '../shared/types.js';
import { defaultAppSettings, isSettingsProvider } from '../shared/types.js';

/** Parse `.env` text into a record. Ignores comments and blank lines. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Loads an .env file; missing file → empty record. */
export function loadDotEnvFile(file: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }

}

/** Sets vars into the environment without clobbering existing ones. */
export function applyToProcessEnv(
  vars: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(vars)) {
    if (!(key in env)) env[key] = value;
  }
}

export interface EnvProviderDefaults {
  openaiBaseUrl: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
}

/** Bootstrap provider defaults from env vars (or any var map). */
export function envProviderDefaults(
  source: Record<string, string | undefined>,
): EnvProviderDefaults {
  return {
    openaiBaseUrl: nonEmpty(source['OPENAI_BASE_URL']),
    openaiApiKey: nonEmpty(source['OPENAI_API_KEY']),
    anthropicApiKey: nonEmpty(source['ANTHROPIC_API_KEY']),
  };
}

function nonEmpty(v: string | undefined): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Legacy settings.json migration: pre-rework files stored thinkModel and
 * writeModel as {provider, model} objects and had NO top-level provider.
 * Map them onto the flat schema without ever crashing:
 *  - provider = legacy thinkModel.provider, normalized ('openai' and anything
 *    non-anthropic → 'openai-compat').
 *  - thinkModel / writeModel = the .model strings.
 * Already-flat records pass through unchanged. Unknown shapes are dropped so
 * the defaults apply. Stale object keys are scrubbed on the next save by
 * settings-service.stripUnknownKeys.
 */
export function migrateStoredSettings(
  stored: Record<string, unknown> | null,
): Partial<AppSettings> | null {
  if (stored === null || typeof stored !== 'object') return null;
  const out: Record<string, unknown> = { ...stored };

  const legacyProvider = (value: unknown): SettingsProvider | null => {
    if (typeof value !== 'object' || value === null) return null;
    const p = (value as Record<string, unknown>)['provider'];
    if (typeof p !== 'string') return null;
    return p === 'anthropic' ? 'anthropic' : 'openai-compat';
  };
  const legacyModel = (value: unknown): string | null => {
    if (typeof value !== 'object' || value === null) return null;
    const m = (value as Record<string, unknown>)['model'];
    return typeof m === 'string' ? m : null;
  };

  for (const key of ['thinkModel', 'writeModel'] as const) {
    const value = out[key];
    if (typeof value === 'string' || value === undefined) continue;
    const model = legacyModel(value);
    if (model !== null) out[key] = model;
    else delete out[key]; // unknown shape: fall back to defaults, never crash
  }

  // No top-level provider in legacy files: derive it from the legacy
  // thinkModel object (the think stage led the old per-stage selection).
  if (!isSettingsProvider(out['provider'])) {
    const derived =
      legacyProvider(stored['thinkModel']) ?? legacyProvider(stored['writeModel']);
    if (derived !== null) out['provider'] = derived;
    else delete out['provider'];
  }

  return out as Partial<AppSettings>;
}

/**
 * Merge order: AppSettings defaults ← .env bootstrap ← stored settings.json.
 * Key/base-URL fields only win from either layer when non-empty, so an
 * explicit settings.json key always beats .env and clearing to '' in
 * settings.json falls back to the bootstrap default.
 *
 * Provider bootstrap: when settings.json does not pick a provider, the .env
 * keys choose the default — only ANTHROPIC_API_KEY set → 'anthropic'; only
 * OPENAI_* set → 'openai-compat'; both set → 'openai-compat'.
 */
export function resolveEffectiveSettings(
  storedRaw: Partial<AppSettings> | null,
  envDefaults: EnvProviderDefaults,
): AppSettings {
  const merged = defaultAppSettings();
  const stored = migrateStoredSettings(storedRaw as Record<string, unknown> | null);

  if (envDefaults.openaiBaseUrl) merged.openaiBaseUrl = envDefaults.openaiBaseUrl;
  if (envDefaults.openaiApiKey) merged.openaiApiKey = envDefaults.openaiApiKey;
  if (envDefaults.anthropicApiKey) merged.anthropicApiKey = envDefaults.anthropicApiKey;

  // .env-driven provider default; both keys set keeps 'openai-compat'.
  const anthropicOnly =
    envDefaults.anthropicApiKey !== null &&
    envDefaults.openaiApiKey === null &&
    envDefaults.openaiBaseUrl === null;
  if (anthropicOnly) merged.provider = 'anthropic';

  if (stored) {
    if (nonEmpty(stored.openaiBaseUrl)) merged.openaiBaseUrl = stored.openaiBaseUrl as string;
    if (nonEmpty(stored.openaiApiKey)) merged.openaiApiKey = stored.openaiApiKey as string;
    if (nonEmpty(stored.anthropicApiKey)) {
      merged.anthropicApiKey = stored.anthropicApiKey as string;
    }
    if (isSettingsProvider(stored.provider)) merged.provider = stored.provider;
    if (typeof stored.thinkModel === 'string' && stored.thinkModel.length > 0) {
      merged.thinkModel = stored.thinkModel;
    }
    if (typeof stored.writeModel === 'string' && stored.writeModel.length > 0) {
      merged.writeModel = stored.writeModel;
    }
    if (typeof stored.language === 'string') merged.language = stored.language;
    if (typeof stored.thinkingEffort === 'string' && stored.thinkingEffort.length > 0) {
      merged.thinkingEffort = stored.thinkingEffort;
    }
    if (typeof stored.writeMaxTokens === 'number' && Number.isFinite(stored.writeMaxTokens)) {
      merged.writeMaxTokens = Math.trunc(stored.writeMaxTokens);
    }
    if (
      typeof stored.contextWindowTokens === 'number' &&
      Number.isFinite(stored.contextWindowTokens)
    ) {
      merged.contextWindowTokens = Math.trunc(stored.contextWindowTokens);
    }
  }

  return merged;
}
