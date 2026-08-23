/**
 * Memory endpoints over memories.jsonl. Entries carry no stable id, so
 * DELETE /memories/:memoryId addresses entries by zero-based line index.
 */

import type { Request, Response, Router } from 'express';
import { param, wrap, type RouteContext } from './context.js';

async function getCampaignOr404(ctx: RouteContext, req: Request, res: Response): Promise<boolean> {
  const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'campaign_not_found' });
    return false;
  }
  return true;
}

export function registerMemoryRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/campaigns/:id/memories',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      res.json({ memories: await ctx.hub.memories.list(param(req, 'id')) });
    }),
  );

  router.delete(
    '/campaigns/:id/memories',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      await ctx.hub.memories.deleteAll(param(req, 'id'));
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/campaigns/:id/memories/:memoryId',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const lineIndex = Number.parseInt(param(req, 'memoryId'), 10);
      if (!Number.isInteger(lineIndex) || lineIndex < 0) {
        res.status(400).json({ ok: false, error: 'invalid_memory_id' });
        return;
      }
      const deleted = await ctx.hub.memories.deleteAt(param(req, 'id'), lineIndex);
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'memory_not_found' });
        return;
      }
      res.json({ ok: true });
    }),
  );
}
