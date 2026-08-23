/**
 * BYOK settings API.
 *
 * GET returns the public view: keys are never echoed back — only *Set flags.
 * PUT merges over the stored overlay; empty-string key fields mean
 * "unchanged" so a client can round-trip the public view safely.
 *
 * `provider` is validated strictly: when present it MUST be one of the two
 * allowed strings ('openai-compat' | 'anthropic'); anything else, including
 * an empty string, is a 400. thinkModel/writeModel are plain model-id
 * strings under the flat schema.
 */

import type { Router } from 'express';
import type { AppSettings } from '../shared/types.js';
import { isSettingsProvider, SETTINGS_PROVIDERS } from '../shared/types.js';
import { publicSettingsView } from '../server/settings-service.js';
import { wrap, type RouteContext } from './context.js';

const EDITABLE_KEYS = [
  'provider',
  'thinkModel',
  'writeModel',
  'openaiBaseUrl',
  'openaiApiKey',
  'anthropicApiKey',
  'language',
  'thinkingEffort',
  'writeMaxTokens',
  'contextWindowTokens',
] as const;

/** Keys whose values must be plain strings to be accepted. */
const STRING_KEYS = new Set<string>([
  'thinkModel',
  'writeModel',
  'openaiBaseUrl',
  'openaiApiKey',
  'anthropicApiKey',
  'language',
  'thinkingEffort',
]);

function pickPatch(body: unknown): Partial<AppSettings> | { invalidProvider: true } {
  if (typeof body !== 'object' || body === null) return {};
  const record = body as Record<string, unknown>;
  if (record['provider'] !== undefined && !isSettingsProvider(record['provider'])) {
    return { invalidProvider: true };
  }
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    if (STRING_KEYS.has(key) && typeof value !== 'string') continue;
    out[key] = value;
  }
  return out as Partial<AppSettings>;
}

export function registerSettingsRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/settings',
    wrap(async (_req, res) => {
      res.json(publicSettingsView(await ctx.settingsService.get()));
    }),
  );

  router.put(
    '/settings',
    wrap(async (req, res) => {
      const patch = pickPatch(req.body);
      if ('invalidProvider' in patch) {
        res.status(400).json({
          ok: false,
          error: 'invalid_provider',
          message: `provider must be one of: ${SETTINGS_PROVIDERS.join(', ')}`,
        });
        return;
      }
      const updated = await ctx.settingsService.update(patch);
      res.json(publicSettingsView(updated));
    }),
  );
}
