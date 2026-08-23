/**
 * Prompt template API + the live prompt preview.
 *
 * GET    /prompt-templates              -> stage metadata + current overrides
 * PUT    /prompt-templates/:key         -> {template} (empty string clears)
 * DELETE /prompt-templates/:key         -> reset to shipped default
 * GET    /campaigns/:id/prompt-preview  -> exact system+user pair, no AI call
 */

import type { Router } from 'express';
import { param, wrap, type RouteContext } from './context.js';
import { PROMPT_STAGES, findStage } from '../server/prompt-registry.js';
import { buildStagePreview } from '../server/prompt-preview.js';

const MAX_TEMPLATE_CHARS = 16384;

export function registerPromptRoutes(router: Router, ctx: RouteContext): void {
  router.get('/prompt-templates', wrap(async (_req, res) => {
    const overrides = await ctx.hub.prompts.load();
    res.json(
      PROMPT_STAGES.map((stage) => ({
        key: stage.key,
        description: stage.description,
        variables: [...stage.variables],
        default: stage.default,
        override: typeof overrides[stage.key] === 'string' ? overrides[stage.key] : null,
      })),
    );
  }));

  router.put('/prompt-templates/:key', wrap(async (req, res) => {
    const key = param(req, 'key');
    if (findStage(key) === null) {
      res.status(404).json({ ok: false, error: 'unknown_stage' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const template = body['template'];
    if (typeof template !== 'string') {
      res.status(400).json({ ok: false, error: 'invalid_template', message: 'template must be a string' });
      return;
    }
    if (template.trim().length === 0) {
      // Empty string = clear the override.
      await ctx.hub.prompts.set(key, null);
      res.json({ ok: true, key, override: null });
      return;
    }
    if (template.length > MAX_TEMPLATE_CHARS) {
      res.status(400).json({
        ok: false,
        error: 'invalid_template',
        message: `template exceeds ${MAX_TEMPLATE_CHARS} characters`,
      });
      return;
    }
    await ctx.hub.prompts.set(key, template);
    res.json({ ok: true, key, override: template });
  }));

  router.delete('/prompt-templates/:key', wrap(async (req, res) => {
    const key = param(req, 'key');
    if (findStage(key) === null) {
      res.status(404).json({ ok: false, error: 'unknown_stage' });
      return;
    }
    await ctx.hub.prompts.set(key, null);
    res.json({ ok: true, key, override: null });
  }));

  router.get('/campaigns/:id/prompt-preview', wrap(async (req, res) => {
    const stageParam = req.query['stage'];
    const stage = Array.isArray(stageParam) ? String(stageParam[0] ?? '') : String(stageParam ?? '');
    if (findStage(stage) === null) {
      res.status(404).json({ ok: false, error: 'unknown_stage', message: `no such stage: ${stage}` });
      return;
    }
    const npcIdRaw = req.query['npcId'];
    const npcId = Array.isArray(npcIdRaw) ? String(npcIdRaw[0] ?? '') : String(npcIdRaw ?? '');
    const playerInputRaw = req.query['playerInput'];
    const playerInput = Array.isArray(playerInputRaw)
      ? String(playerInputRaw[0] ?? '')
      : String(playerInputRaw ?? '');

    const settings = await ctx.effectiveSettings();
    const preview = await buildStagePreview({
      hub: ctx.hub,
      settings,
      campaignId: param(req, 'id'),
      stage,
      playerInput,
      npcId: npcId.length > 0 ? npcId : null,
    });
    if (preview === 'campaign_not_found') {
      res.status(404).json({ ok: false, error: 'campaign_not_found' });
      return;
    }
    if (preview === null) {
      res.status(400).json({ ok: false, error: 'preview_unavailable' });
      return;
    }
    res.json(preview);
  }));
}
