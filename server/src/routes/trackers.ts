/**
 * Narrative status board endpoints (campaign.trackerState).
 *
 * GET /campaigns/:id/tracker -> { trackerState } (null = never generated)
 * PUT /campaigns/:id/tracker { trackerState } -> manual edit; strict shape
 *   validation, 400 on garbage; persists with an updatedAt bump.
 *
 * Unrelated to Npc.trackers (the numeric per-NPC stats edited via npcs.ts).
 */

import type { Router } from 'express';
import type { TrackerEntry, TrackerState } from '../shared/types.js';
import { param, wrap, type RouteContext } from './context.js';

function validTrackerEntry(value: unknown): value is TrackerEntry & { innerVoice?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['look'] === 'string' &&
    typeof v['condition'] === 'string' &&
    typeof v['carrying'] === 'string' &&
    (v['innerVoice'] === undefined || typeof v['innerVoice'] === 'string')
  );
}

/** Strict shape check for a client-supplied board. Returns null on garbage. */
export function validateTrackerState(value: unknown): TrackerState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['dateTime'] !== 'string' ||
    typeof v['location'] !== 'string' ||
    typeof v['atmosphere'] !== 'string'
  ) {
    return null;
  }
  if (v['player'] !== null && !validTrackerEntry(v['player'])) return null;
  if (typeof v['npcs'] !== 'object' || v['npcs'] === null || Array.isArray(v['npcs'])) return null;
  const npcsRaw = v['npcs'] as Record<string, unknown>;
  const npcs: TrackerState['npcs'] = {};
  for (const [id, entry] of Object.entries(npcsRaw)) {
    if (!validTrackerEntry(entry)) return null;
    npcs[id] = entry;
  }
  if (v['updatedAtTurn'] !== null && !Number.isFinite(v['updatedAtTurn'])) return null;
  return {
    dateTime: v['dateTime'],
    location: v['location'],
    atmosphere: v['atmosphere'],
    player: v['player'],
    npcs,
    updatedAtTurn:
      typeof v['updatedAtTurn'] === 'number' ? Math.trunc(v['updatedAtTurn']) : null,
  };
}

async function getCampaignOr404(
  ctx: RouteContext,
  id: string,
  res: import('express').Response,
): Promise<boolean> {
  const campaign = await ctx.hub.campaigns.get(id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'campaign_not_found' });
    return false;
  }
  return true;
}

export function registerTrackerRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/campaigns/:id/tracker',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      if (!(await getCampaignOr404(ctx, id, res))) return;
      const campaign = await ctx.hub.campaigns.get(id);
      res.json({ trackerState: campaign?.trackerState ?? null });
    }),
  );

  router.put(
    '/campaigns/:id/tracker',
    wrap(async (req, res) => {
      const id = param(req, 'id');
      if (!(await getCampaignOr404(ctx, id, res))) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const trackerState = validateTrackerState(body['trackerState']);
      if (trackerState === null) {
        res.status(400).json({ ok: false, error: 'invalid_tracker_state' });
        return;
      }
      const campaign = await ctx.hub.campaigns.get(id);
      if (!campaign) {
        res.status(404).json({ ok: false, error: 'campaign_not_found' });
        return;
      }
      const updated = { ...campaign, trackerState, updatedAt: Date.now() };
      await ctx.hub.campaigns.save(updated);
      res.json({ ok: true, trackerState: updated.trackerState });
    }),
  );
}
