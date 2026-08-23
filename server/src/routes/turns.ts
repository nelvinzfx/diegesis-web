/**
 * Turn endpoints.
 *
 * GET  /campaigns/:id/turns            → all turns (variants included)
 * POST /campaigns/:id/turns            → SSE turn execution stream
 * DELETE /campaigns/:id/turns/:index   → Android truncation: deletes that
 *                                        turn and every later one
 *
 * SSE events: stage {line}, reasoning {text}, token {text}, error {message},
 * done {turn, variant}. Client disconnect aborts the pipeline's provider
 * calls via the scoped caller; the orchestrator persists the partial variant
 * with interrupted=true — same stop-persists-partial behavior as Android.
 */

import type { Request, Response, Router } from 'express';
import type { Turn } from '../shared/types.js';
import { param, scopeToRequest, wrap, type RouteContext } from './context.js';
import { sseEnd, sseInit, sseSend } from './sse.js';
import { maybeGenerateTitle } from '../server/title-service.js';

async function getCampaignOr404(ctx: RouteContext, req: Request, res: Response): Promise<boolean> {
  const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'campaign_not_found' });
    return false;
  }
  return true;
}

/** Finds the persisted turn containing a freshly saved variant. */
async function findTurnByVariantId(
  ctx: RouteContext,
  campaignId: string,
  variantId: string,
): Promise<Turn | null> {
  const turns = await ctx.hub.turns.list(campaignId);
  return turns.find((t) => t.variants.some((v) => v.id === variantId)) ?? null;
}

export function registerTurnRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/campaigns/:id/turns',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      res.json({ turns: await ctx.hub.turns.list(param(req, 'id')) });
    }),
  );

  router.delete(
    '/campaigns/:id/turns/:index',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const index = Number.parseInt(param(req, 'index'), 10);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ ok: false, error: 'invalid_index' });
        return;
      }
      const removed = await ctx.hub.turns.deleteFrom(param(req, 'id'), index);
      res.json({ ok: true, removed });
    }),
  );

  router.post(
    '/campaigns/:id/turns',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const campaignId = param(req, 'id');
      const body = (req.body ?? {}) as { playerInput?: unknown; targetTurnIndex?: unknown };
      const playerInput =
        typeof body.playerInput === 'string' ? body.playerInput.trim() : '';
      if (playerInput.length === 0) {
        res.status(400).json({ ok: false, error: 'player_input_required' });
        return;
      }
      const targetTurnIndex =
        typeof body.targetTurnIndex === 'number' && Number.isInteger(body.targetTurnIndex)
          ? body.targetTurnIndex
          : null;

      const settings = await ctx.effectiveSettings();
      const controller = new AbortController();
      // Client disconnect (stop button / navigation away) cancels provider
      // streams mid-flight; the orchestrator then persists partial output.
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      sseInit(res);
      const caller = scopeToRequest(await ctx.aiCaller(), controller.signal);
      const orchestrator = await ctx.createOrchestrator(caller, {
        contextWindowTokens: settings.contextWindowTokens,
        writeMaxTokens: settings.writeMaxTokens,
      });

      try {
        const variant = await orchestrator.executeTurn({
          campaignId,
          playerInput,
          ...(targetTurnIndex !== null ? { targetTurnIndex } : {}),
          onPipelineEvent: (line) => sseSend(res, 'stage', { line }),
          onReasoningChunk: (text) => sseSend(res, 'reasoning', { text }),
          onChunk: (text) => sseSend(res, 'token', { text }),
        });
        const turn = await findTurnByVariantId(ctx, campaignId, variant.id);
        // Auto title: first completed turn names an untitled campaign (one
        // cheap THINK call, hard-capped at MAX_TITLE_CHARS).
        let campaignTitle: string | undefined;
        const storedCampaign = await ctx.hub.campaigns.get(campaignId);
        if (storedCampaign) {
          const titleOverrides = await ctx.hub.prompts.load();
          const title = await maybeGenerateTitle({
            caller,
            settings,
            campaign: storedCampaign,
            turn,
            getTemplate: (key) => titleOverrides[key] ?? null,
          });
          if (title !== null) {
            await ctx.hub.campaigns.save({ ...storedCampaign, title, updatedAt: Date.now() });
            campaignTitle = title;
          }
        }
        sseSend(res, 'done', {
          turn:
            turn ??
            ({
              index: -1,
              playerInput,
              variants: [variant],
              createdAt: Date.now(),
            } satisfies Turn),
          variant,
          ...(campaignTitle !== undefined ? { campaignTitle } : {}),
        });
      } catch (error) {
        sseSend(res, 'error', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        sseEnd(res);
      }
    }),
  );
}
