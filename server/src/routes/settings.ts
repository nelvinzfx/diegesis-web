/**
 * BYOK settings API.
 *
 * GET returns the public view: keys are never echoed back — only *Set flags.
 * PUT merges over the stored overlay; empty-string key fields mean
 * "unchanged" so a client can round-trip the public view safely.
 */

import type { Router } from 'express';
import type { AppSettings } from '../shared/types.js';
import { publicSettingsView } from '../server/settings-service.js';
import { wrap, type RouteContext } from './context.js';

const EDITABLE_KEYS = [
  'openaiBaseUrl',
  'openaiApiKey',
  'anthropicApiKey',
  'language',
  'thinkingEffort',
  'writeMaxTokens',
  'contextWindowTokens',
] as const;

function pickPatch(body: unknown): Partial<AppSettings> {
  if (typeof body !== 'object' || body === null) return {};
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if ((body as Record<string, unknown>)[key] !== undefined) {
      out[key] = (body as Record<string, unknown>)[key];
    }
  }
  for (const key of ['thinkModel', 'writeModel'] as const) {
    const value = (body as Record<string, unknown>)[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>)['provider'] === 'string' &&
      typeof (value as Record<string, unknown>)['model'] === 'string'
    ) {
      out[key] = value;
    }
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
      const updated = await ctx.settingsService.update(patch);
      res.json(publicSettingsView(updated));
    }),
  );
}
