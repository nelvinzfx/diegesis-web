/**
 * Opening scene endpoints.
 *
 * POST /campaigns/:id/opening/generate -> SSE stream (THINK model, 'opening'
 *   template) that drafts an opening scene from live campaign + NPC context.
 *   Does NOT persist; the done event carries {text} and the client saves it
 *   via PUT /campaigns/:id (openingMessage).
 *
 * POST /campaigns/:id/opening -> creates turn 0 from a stored opening:
 *   campaign.openingMessage, else the FIRST present NPC's firstMessage, else
 *   400 {error:'no_opening'}. Turn 0 is a real turn (playerInput '', one
 *   variant whose sceneOutput is the opening text). When turn 0 already
 *   exists a new variant is appended instead (regenerate semantics).
 *
 * SSE events on /generate: stage {line}, reasoning {text}, token {text},
 * error {message}, done {text} — same shape as the plan stream.
 */

import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import type { AppSettings, Campaign, Npc, Turn, TurnVariant } from '../shared/types.js';
import { resolvePrompt, type PromptTemplateGetter } from '../engine/prompt-templates.js';
import type { StorageHub } from '../storage/hub.js';
import { param, scopeToRequest, wrap, type RouteContext } from './context.js';
import { sseEnd, sseInit, sseSend } from './sse.js';

export const DEFAULT_OPENING_SYSTEM_PROMPT = `You are the narrator of a tabletop RPG campaign. Write the opening scene of the story.

Ground every detail in the material below:
- The campaign title and premise: establish the central tension, do not resolve it.
- The session plan: open on or just before its first beat.
- The location: the scene happens here, establish it with concrete sensory detail.
- The player persona: address the player in second person as this character.
- The present NPCs: introduce each by name with a short vivid description of what they are doing right now. When an NPC provides an opening message, weave its content into the scene naturally (do not quote it verbatim).
- Write all narration and dialogue in {{language}}.

Craft:
- 3 to 5 paragraphs of immersive prose, second person, present tense.
- End at a moment that invites the player's first action; never act for the player.
- No headings, no meta commentary, no lists — prose only.`;

/** Variable values interpolated into the opening template. */
export type OpeningTemplateValues = {
  title: string;
  premise: string;
  sessionPlan: string;
  location: string;
  playerPersona: string;
  presentNpcs: string;
  language: string;
};

/** System prompt with template override support ('opening' stage key). */
export function resolveOpeningSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  values: OpeningTemplateValues,
): string {
  return resolvePrompt(getTemplate, 'opening', DEFAULT_OPENING_SYSTEM_PROMPT, values);
}

/** Formats the present NPCs (name, description, optional first message). */
export function formatPresentNpcs(npcs: Npc[]): string {
  if (npcs.length === 0) return '(no NPCs present in the opening scene)';
  return npcs
    .map((npc) => {
      let line = `- ${npc.name}`;
      if (npc.description.trim().length > 0) line += `: ${npc.description.trim()}`;
      if (npc.firstMessage.trim().length > 0) {
        line += `\n  Opening message to weave in: ${npc.firstMessage.trim()}`;
      }
      return line;
    })
    .join('\n');
}

/** Builds the template variable values from campaign + present NPC context. */
export async function buildOpeningValues(
  hub: StorageHub,
  settings: AppSettings,
  campaign: Campaign,
): Promise<OpeningTemplateValues> {
  const presentNpcs: Npc[] = [];
  for (const id of campaign.sceneState.presentNpcIds) {
    const npc = await hub.npcs.get(campaign.id, id);
    if (npc) presentNpcs.push(npc);
  }
  return {
    title: campaign.title.trim().length > 0 ? campaign.title.trim() : 'Untitled',
    premise: campaign.premise.trim().length > 0 ? campaign.premise.trim() : '(no premise given)',
    sessionPlan:
      campaign.sessionPlan.trim().length > 0 ? campaign.sessionPlan.trim() : '(no session plan yet)',
    location:
      campaign.sceneState.location.trim().length > 0
        ? campaign.sceneState.location.trim()
        : '(unspecified)',
    playerPersona:
      campaign.playerPersona.trim().length > 0
        ? campaign.playerPersona.trim()
        : '(unspecified)',
    presentNpcs: formatPresentNpcs(presentNpcs),
    language: settings.language?.trim() || 'English',
  };
}

/**
 * One-line summary of an opening: its first sentence, capped at ~120 chars.
 * Plain string slicing, no AI call.
 */
export function summarizeOpening(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length === 0) return '';
  const match = compact.match(/[^.!?]*[.!?]/);
  const firstSentence = (match === null ? compact : match[0]).trim();
  if (firstSentence.length <= 120) return firstSentence;
  return `${firstSentence.slice(0, 117).trimEnd()}...`;
}

/** Builds the turn-0 variant for a stored opening text. */
function openingVariant(campaign: Campaign, text: string): TurnVariant {
  return {
    id: randomUUID(),
    synopsis: summarizeOpening(text),
    sceneOutput: text,
    routerDecision: null,
    presentNpcIds: campaign.sceneState.presentNpcIds,
    mechanicResults: [],
    interrupted: false,
    timestamp: Date.now(),
    stageEvents: ['opening: created from the stored opening message'],
    reasoning: null,
    tension: null,
  };
}

export function registerOpeningRoutes(router: Router, ctx: RouteContext): void {
  router.post(
    '/campaigns/:id/opening/generate',
    wrap(async (req, res) => {
      const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
      if (!campaign) {
        res.status(404).json({ ok: false, error: 'campaign_not_found' });
        return;
      }

      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      sseInit(res);
      const caller = scopeToRequest(await ctx.aiCaller(), controller.signal);
      sseSend(res, 'stage', { line: 'opening: drafting…' });

      const parts: string[] = [];
      try {
        const overrides = await ctx.hub.prompts.load();
        const values = await buildOpeningValues(
          ctx.hub,
          await ctx.effectiveSettings(),
          campaign,
        );
        const systemPrompt = resolveOpeningSystemPrompt((key) => overrides[key] ?? null, values);
        const stream = caller.streamThink(
          systemPrompt,
          'Write the opening scene now.',
          {
            onReasoningChunk: (text) => sseSend(res, 'reasoning', { text }),
          },
        );
        for await (const chunk of stream) {
          parts.push(chunk);
          sseSend(res, 'token', { text: chunk });
        }
      } catch (error) {
        sseSend(res, 'error', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Not persisted: the client saves the text via PUT /campaigns/:id.
        sseSend(res, 'done', { text: parts.join('') });
        sseEnd(res);
      }
    }),
  );

  router.post(
    '/campaigns/:id/opening',
    wrap(async (req, res) => {
      const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
      if (!campaign) {
        res.status(404).json({ ok: false, error: 'campaign_not_found' });
        return;
      }

      const stored = campaign.openingMessage.trim();
      let text = stored;
      if (text.length === 0) {
        for (const id of campaign.sceneState.presentNpcIds) {
          const npc = await ctx.hub.npcs.get(campaign.id, id);
          if (npc && npc.firstMessage.trim().length > 0) {
            text = npc.firstMessage;
            break;
          }
        }
      }
      if (text.trim().length === 0) {
        res.status(400).json({ ok: false, error: 'no_opening' });
        return;
      }

      const variant = openingVariant(campaign, text);
      const existing = await ctx.hub.turns.get(campaign.id, 0);
      if (existing) {
        // Regenerate semantics: turn 0 exists, append a new variant.
        await ctx.hub.turns.appendVariant(campaign.id, 0, variant);
        const updated = await ctx.hub.turns.get(campaign.id, 0);
        res.json({ turn: updated ?? existing });
        return;
      }
      const turn: Turn = {
        index: 0,
        playerInput: '',
        variants: [variant],
        createdAt: Date.now(),
      };
      await ctx.hub.turns.save(campaign.id, turn);
      res.status(201).json({ turn });
    }),
  );
}
