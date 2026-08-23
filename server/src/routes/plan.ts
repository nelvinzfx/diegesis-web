/** Normalizes the optional inline-edit fields for template interpolation. */
function planFieldValues(input: { title?: unknown; premise?: unknown; playerPersona?: unknown }): {
  title: string;
  premise: string;
  playerPersona: string;
} {
  return {
    title:
      typeof input.title === 'string' && input.title.trim().length > 0 ? input.title.trim() : 'Untitled',
    premise:
      typeof input.premise === 'string' && input.premise.trim().length > 0
        ? input.premise.trim()
        : '(no premise given)',
    playerPersona:
      typeof input.playerPersona === 'string' && input.playerPersona.trim().length > 0
        ? input.playerPersona.trim()
        : '(unspecified)',
  };
}

/**
 * Session-plan generation. Streams prose + reasoning over SSE from the THINK
 * model and persists the result into campaign.sessionPlan (partial prose is
 * kept too, matching stop-persists-partial semantics).
 *
 * Events: stage {line} boundaries, reasoning {text}, token {text},
 * error {message}, done {campaign}.
 */

import type { Router } from 'express';
import { resolvePrompt, type PromptTemplateGetter } from '../engine/prompt-templates.js';
import { param, scopeToRequest, wrap, type RouteContext } from './context.js';
import { sseEnd, sseInit, sseSend } from './sse.js';

export const DEFAULT_PLAN_SYSTEM_PROMPT = `You are a session-planning assistant for a tabletop RPG campaign.

Draft a concise session plan in markdown with these sections:
- Premise (one short paragraph)
- Scene beats (3-6 beats, each escalating pressure toward a climax)
- Open threads (mysteries, debts, unresolved NPC goals)
- NPC hooks (who can drive the next session)

Output markdown only — no meta commentary.`;

/**
 * System prompt with template override support. Variables:
 * {{title}}, {{premise}}, {{playerPersona}}.
 */
export function resolvePlanSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  values: { title: string; premise: string; playerPersona: string },
): string {
  return resolvePrompt(getTemplate, 'session-plan', DEFAULT_PLAN_SYSTEM_PROMPT, values);
}

export function planUserPrompt(input: { title?: unknown; premise?: unknown; playerPersona?: unknown }): string {
  const title = typeof input.title === 'string' && input.title.trim().length > 0 ? input.title.trim() : 'Untitled';
  const premise =
    typeof input.premise === 'string' && input.premise.trim().length > 0 ? input.premise.trim() : '(no premise given)';
  const persona =
    typeof input.playerPersona === 'string' && input.playerPersona.trim().length > 0
      ? input.playerPersona.trim()
      : '(unspecified)';
  return `Campaign title: ${title}\nPremise: ${premise}\nPlayer persona: ${persona}\n\nDraft the session plan.`;
}

export function registerPlanRoute(router: Router, ctx: RouteContext): void {
  router.post(
    '/campaigns/:id/plan',
    wrap(async (req, res) => {
      const campaign = await ctx.hub.campaigns.get(param(req, 'id'));
      if (!campaign) {
        res.status(404).json({ ok: false, error: 'campaign_not_found' });
        return;
      }

      // Optional inline edits before planning (title/premise/playerPersona),
      // so the plan reflects what the user just typed without a prior PUT.
      const body = (req.body ?? {}) as Record<string, unknown>;
      let current = campaign;
      for (const field of ['title', 'premise', 'playerPersona'] as const) {
        if (typeof body[field] === 'string') {
          current = { ...current, [field]: body[field] as string };
        }
      }
      if (current !== campaign) {
        current = { ...current, updatedAt: Date.now() };
        await ctx.hub.campaigns.save(current);
      }

      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      sseInit(res);
      const caller = scopeToRequest(await ctx.aiCaller(), controller.signal);
      sseSend(res, 'stage', { line: 'plan: drafting…' });

      const parts: string[] = [];
      try {
        const overrides = await ctx.hub.prompts.load();
        const systemPrompt = resolvePlanSystemPrompt(
          (key) => overrides[key] ?? null,
          planFieldValues(body),
        );
        const stream = caller.streamThink(systemPrompt, planUserPrompt(body), {
          onReasoningChunk: (text) => sseSend(res, 'reasoning', { text }),
        });
        for await (const chunk of stream) {
          parts.push(chunk);
          sseSend(res, 'token', { text: chunk });
        }
      } catch (error) {
        sseSend(res, 'error', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Persist whatever we got, even on error/abort (partial plan kept).
        const prose = parts.join('');
        let saved = current;
        if (prose.length > 0) {
          saved = { ...current, sessionPlan: prose, updatedAt: Date.now() };
          await ctx.hub.campaigns.save(saved);
        }
        sseSend(res, 'done', { campaign: saved });
        sseEnd(res);
      }
    }),
  );
}
