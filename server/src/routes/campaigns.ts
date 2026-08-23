/**
 * Campaign CRUD. PUT preserves everything except the edited fields (same
 * semantics as the Android CampaignEdit): id and createdAt are never taken
 * from the client; updatedAt is bumped on save.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import type { Campaign, SceneState, StageModelSelection } from '../shared/types.js';
import { defaultSceneState } from '../shared/types.js';
import { param, wrap, type RouteContext } from './context.js';

interface CampaignPatch {
  title?: string;
  premise?: string;
  sessionPlan?: string;
  playerPersona?: string;
  openingMessage?: string;
  sceneState?: SceneState;
  thinkModel?: StageModelSelection | null;
  writeModel?: StageModelSelection | null;
}

function applyPatch(campaign: Campaign, body: CampaignPatch): Campaign {
  return {
    ...campaign,
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.premise === 'string' ? { premise: body.premise } : {}),
    ...(typeof body.sessionPlan === 'string' ? { sessionPlan: body.sessionPlan } : {}),
    ...(typeof body.playerPersona === 'string' ? { playerPersona: body.playerPersona } : {}),
    ...(typeof body.openingMessage === 'string' ? { openingMessage: body.openingMessage } : {}),
    ...(body.sceneState !== undefined && typeof body.sceneState === 'object'
      ? {
          sceneState: {
            location:
              typeof body.sceneState.location === 'string' ? body.sceneState.location : '',
            presentNpcIds: Array.isArray(body.sceneState.presentNpcIds)
              ? body.sceneState.presentNpcIds.filter((id): id is string => typeof id === 'string')
              : [],
          },
        }
      : {}),
    ...(body.thinkModel !== undefined
      ? { thinkModel: validSelectionOrNull(body.thinkModel) }
      : {}),
    ...(body.writeModel !== undefined
      ? { writeModel: validSelectionOrNull(body.writeModel) }
      : {}),
    updatedAt: Date.now(),
  };
}

function validSelectionOrNull(value: unknown): StageModelSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const provider = (value as Record<string, unknown>)['provider'];
  const model = (value as Record<string, unknown>)['model'];
  if (typeof provider !== 'string' || typeof model !== 'string') return null;
  return { provider, model };
}

async function getCampaignOr404(ctx: RouteContext, req: Request, res: Response): Promise<Campaign | null> {
  const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
  if (!campaign) res.status(404).json({ ok: false, error: 'campaign_not_found' });
  return campaign;
}

export function registerCampaignRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/campaigns',
    wrap(async (_req, res) => {
      res.json({ campaigns: await ctx.hub.campaigns.list() });
    }),
  );

  router.post(
    '/campaigns',
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as CampaignPatch;
      const now = Date.now();
      const campaign: Campaign = applyPatch(
        {
          id: randomUUID(),
          title: 'Untitled',
          premise: '',
          sessionPlan: '',
          playerPersona: '',
          openingMessage: '',
          sceneState: defaultSceneState(),
          thinkModel: null,
          writeModel: null,
          createdAt: now,
          updatedAt: now,
        },
        body,
      );
      await ctx.hub.campaigns.save(campaign);
      res.status(201).json(campaign);
    }),
  );

  router.get(
    '/campaigns/:id',
    wrap(async (req, res) => {
      const campaign = await getCampaignOr404(ctx, req, res);
      if (campaign) res.json(campaign);
    }),
  );

  router.put(
    '/campaigns/:id',
    wrap(async (req, res) => {
      const campaign = await getCampaignOr404(ctx, req, res);
      if (!campaign) return;
      const updated = applyPatch(campaign, (req.body ?? {}) as CampaignPatch);
      await ctx.hub.campaigns.save(updated);
      res.json(updated);
    }),
  );

  router.delete(
    '/campaigns/:id',
    wrap(async (req, res) => {
      const deleted = await ctx.hub.campaigns.delete(param(req, 'id'));
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'campaign_not_found' });
        return;
      }
      res.json({ ok: true });
    }),
  );
}
