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

  // In-place edit of an existing turn: the player's cue text and/or one
  // variant's scene prose, without rerunning anything. variantId picks the
  // variant to edit; omitted = the latest variant.
  router.put(
    '/campaigns/:id/turns/:index',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const campaignId = param(req, 'id');
      const index = Number.parseInt(param(req, 'index'), 10);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ ok: false, error: 'invalid_index' });
        return;
      }
      const body = (req.body ?? {}) as {
        playerInput?: unknown;
        variantId?: unknown;
        sceneOutput?: unknown;
      };
      const editCue = typeof body.playerInput === 'string';
      const editProse = typeof body.sceneOutput === 'string';
      if (!editCue && !editProse) {
        res.status(400).json({ ok: false, error: 'nothing_to_update' });
        return;
      }
      if (editCue && (body.playerInput as string).trim().length === 0 && index !== 0) {
        res.status(400).json({ ok: false, error: 'player_input_required' });
        return;
      }
      const turn = await ctx.hub.turns.get(campaignId, index);
      if (!turn) {
        res.status(404).json({ ok: false, error: 'turn_not_found' });
        return;
      }
      if (editCue) turn.playerInput = (body.playerInput as string).trim();
      if (editProse) {
        const variantId = typeof body.variantId === 'string' ? body.variantId : null;
        const variant =
          variantId !== null
            ? turn.variants.find((v) => v.id === variantId)
            : turn.variants[turn.variants.length - 1];
        if (!variant) {
          res.status(404).json({ ok: false, error: 'variant_not_found' });
          return;
        }
        variant.sceneOutput = body.sceneOutput as string;
      }
      await ctx.hub.turns.save(campaignId, turn);
      res.json({ turn });
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
      const targetTurnIndex =
        typeof body.targetTurnIndex === 'number' && Number.isInteger(body.targetTurnIndex)
          ? body.targetTurnIndex
          : null;
      // Turn 0 (the opening scene) has no player input by design; regenerating
      // it sends an empty string with targetTurnIndex 0.
      if (playerInput.length === 0 && targetTurnIndex !== 0) {
        res.status(400).json({ ok: false, error: 'player_input_required' });
        return;
      }

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
          // Live status board after this turn; null = update failed/never ran.
          trackerState: storedCampaign?.trackerState ?? null,
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
