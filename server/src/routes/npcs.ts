/**
 * NPC CRUD + character-card import.
 *
 * POST /npcs/import accepts either:
 *  - application/json with body { json: "<card v2 JSON>" }, or
 *  - raw PNG bytes (content-type image/png or application/octet-stream)
 *    with an embedded `chara` tEXt chunk — both via the engine importer.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import type { Npc, NpcAgency } from '../shared/types.js';
import { defaultNpcAgency } from '../shared/types.js';
import { fromJson, fromPngBytes } from '../engine/card-importer.js';
import { PNG_SIGNATURE } from './png-signature.js';
import { param, wrap, type RouteContext } from './context.js';

const NPC_EDITABLE = [
  'name',
  'description',
  'personality',
  'voiceExamples',
  'agency',
  'trackers',
] as const;

function applyPatch(npc: Npc, body: Record<string, unknown>): Npc {
  const out: Npc = { ...npc };
  if (typeof body['name'] === 'string') out.name = body['name'];
  if (typeof body['description'] === 'string') out.description = body['description'];
  if (typeof body['personality'] === 'string') out.personality = body['personality'];
  if (typeof body['firstMessage'] === 'string') out.firstMessage = body['firstMessage'];
  if (Array.isArray(body['voiceExamples'])) {
    out.voiceExamples = body['voiceExamples'].filter((v): v is string => typeof v === 'string');
  }
  if (typeof body['agency'] === 'object' && body['agency'] !== null) {
    const a = body['agency'] as Partial<NpcAgency>;
    out.agency = {
      goal: typeof a.goal === 'string' ? a.goal : npc.agency.goal,
      stance: typeof a.stance === 'string' ? a.stance : npc.agency.stance,
      will_act_on: typeof a.will_act_on === 'string' ? a.will_act_on : npc.agency.will_act_on,
    };
  }
  if (typeof body['trackers'] === 'object' && body['trackers'] !== null) {
    const trackers: Record<string, number> = {};
    for (const [key, value] of Object.entries(body['trackers'] as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) trackers[key] = value;
    }
    out.trackers = trackers;
  }
  return out;
}

async function getCampaignOr404(ctx: RouteContext, req: Request, res: Response): Promise<boolean> {
  const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'campaign_not_found' });
    return false;
  }
  return true;
}

async function getNpcOr404(ctx: RouteContext, req: Request, res: Response): Promise<Npc | null> {
  const npc = await ctx.hub.npcs.get(param(req, 'id'), param(req, 'npcId'));
  if (!npc) res.status(404).json({ ok: false, error: 'npc_not_found' });
  return npc;
}

export function registerNpcRoutes(router: Router, ctx: RouteContext): void {
  router.get(
    '/campaigns/:id/npcs',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      res.json({ npcs: await ctx.hub.npcs.list(param(req, 'id')) });
    }),
  );

  router.post(
    '/campaigns/:id/npcs',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const base: Npc = {
        id: randomUUID(),
        name: 'Unnamed',
        description: '',
        personality: '',
        voiceExamples: [],
        firstMessage: '',
        agency: defaultNpcAgency(),
        trackers: {},
        sourceCard: null,
      };
      const npc = applyPatch(base, (req.body ?? {}) as Record<string, unknown>);
      await ctx.hub.npcs.save(param(req, 'id'), npc);
      res.status(201).json(npc);
    }),
  );

  router.post(
    '/campaigns/:id/npcs/import',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const campaignId = param(req, 'id');
      let npc: Npc;
      try {
        if (req.is('application/json')) {
          const body = (req.body ?? {}) as { json?: unknown };
          if (typeof body.json !== 'string' || body.json.trim().length === 0) {
            res.status(400).json({ ok: false, error: 'expected_body_json_field' });
            return;
          }
          npc = fromJson(body.json, randomUUID());
        } else if (Buffer.isBuffer(req.body)) {
          const bytes = new Uint8Array(req.body);
          if (!looksLikePng(bytes)) {
            res.status(400).json({ ok: false, error: 'invalid_png' });
            return;
          }
          npc = fromPngBytes(bytes, randomUUID());
        } else {
          res.status(400).json({
            ok: false,
            error: 'unsupported_content_type',
          });
          return;
        }
      } catch (error) {
        res.status(400).json({
          ok: false,
          error: 'card_import_failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      await ctx.hub.npcs.save(campaignId, npc);
      res.status(201).json(npc);
    }),
  );

  router.get(
    '/campaigns/:id/npcs/:npcId',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const npc = await getNpcOr404(ctx, req, res);
      if (npc) res.json(npc);
    }),
  );

  router.put(
    '/campaigns/:id/npcs/:npcId',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const npc = await getNpcOr404(ctx, req, res);
      if (!npc) return;
      const updated = applyPatch(npc, (req.body ?? {}) as Record<string, unknown>);
      await ctx.hub.npcs.save(param(req, 'id'), updated);
      res.json(updated);
    }),
  );

  router.delete(
    '/campaigns/:id/npcs/:npcId',
    wrap(async (req, res) => {
      if (!(await getCampaignOr404(ctx, req, res))) return;
      const existing = await ctx.hub.npcs.get(param(req, 'id'), param(req, 'npcId'));
      if (!existing) {
        res.status(404).json({ ok: false, error: 'npc_not_found' });
        return;
      }
      await ctx.hub.npcs.delete(param(req, 'id'), param(req, 'npcId'));
      res.json({ ok: true });
    }),
  );
}

function looksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}
