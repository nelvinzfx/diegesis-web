/**
 * dotenv-style .env loading (manual parse — no dependency) plus the
 * settings-precedence rule: defaults < server/.env bootstrap keys <
 * data/settings.json (settings.json always wins once a value is set).
 */

import { readFileSync } from 'node:fs';
import type { AppSettings } from '../shared/types.js';
import { defaultAppSettings } from '../shared/types.js';

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
 * Merge order: AppSettings defaults ← .env bootstrap ← stored settings.json.
 * Key/base-URL fields only win from either layer when non-empty, so an
 * explicit settings.json key always beats .env and clearing to '' in
 * settings.json falls back to the bootstrap default.
 */
export function resolveEffectiveSettings(
  stored: Partial<AppSettings> | null,
  envDefaults: EnvProviderDefaults,
): AppSettings {
  const merged = defaultAppSettings();

  if (envDefaults.openaiBaseUrl) merged.openaiBaseUrl = envDefaults.openaiBaseUrl;
  if (envDefaults.openaiApiKey) merged.openaiApiKey = envDefaults.openaiApiKey;
  if (envDefaults.anthropicApiKey) merged.anthropicApiKey = envDefaults.anthropicApiKey;

  if (stored) {
    if (nonEmpty(stored.openaiBaseUrl)) merged.openaiBaseUrl = stored.openaiBaseUrl as string;
    if (nonEmpty(stored.openaiApiKey)) merged.openaiApiKey = stored.openaiApiKey as string;
    if (nonEmpty(stored.anthropicApiKey)) {
      merged.anthropicApiKey = stored.anthropicApiKey as string;
    }
    if (stored.thinkModel !== undefined) merged.thinkModel = { ...stored.thinkModel };
    if (stored.writeModel !== undefined) merged.writeModel = { ...stored.writeModel };
    if (typeof stored.language === 'string') merged.language = stored.language;
    if (typeof stored.thinkingEffort === 'string' && stored.thinkingEffort.length > 0) {
      merged.thinkingEffort = stored.thinkingEffort;
    }
    if (typeof stored.thinkMaxTokens === 'number' && Number.isFinite(stored.thinkMaxTokens)) {
      merged.thinkMaxTokens = Math.trunc(stored.thinkMaxTokens);
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
