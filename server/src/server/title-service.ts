/**
 * Auto title: when a campaign is still untitled ('Untitled' or blank), the
 * first completed turn triggers one cheap THINK call that names the story.
 * The title is aggressively cleaned and hard-capped so the top bar never
 * gets a sentence.
 */

import type { AiCaller } from '../engine/ai-caller.js';
import { applyTemplate, resolvePrompt, type PromptTemplateGetter } from '../engine/prompt-templates.js';
import type { AppSettings, Campaign, Turn } from '../shared/types.js';

export const MAX_TITLE_CHARS = 40;

export const DEFAULT_TITLE_SYSTEM =
  'You title stories. Reply with ONLY the title: 2 to 5 words, at most ' +
  "{{maxChars}} characters, written in the story's language. " +
  'No quotes, no trailing punctuation, no explanation.';

/**
 * Title prompts with template override support. System variables:
 * {{maxChars}}, {{language}}, {{playerInput}}, {{synopsis}}. The user prompt
 * is fixed (it is pure data assembly), but {{maxChars}} there is interpolated.
 */
export function resolveTitleSystemPrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  language: string,
): string {
  return resolvePrompt(getTemplate, 'title', DEFAULT_TITLE_SYSTEM, {
    maxChars: String(MAX_TITLE_CHARS),
    language,
    playerInput: '',
    synopsis: '',
  });
}

export function buildTitleUserPrompt(input: {
  language: string;
  playerInput: string;
  synopsis: string;
}): string {
  return (
    `Language: ${input.language}\n` +
    `Player action: ${input.playerInput}\n` +
    `Scene synopsis: ${input.synopsis}\n` +
    `Title (max ${MAX_TITLE_CHARS} chars):`
  );
}

export function isAutoTitleDue(campaign: Campaign): boolean {
  const t = campaign.title.trim();
  return t.length === 0 || t === 'Untitled';
}

/** Pure sanitizer: quotes out, whitespace collapsed, cap at word boundary. */
export function cleanTitle(raw: string): string {
  let t = raw.trim();
  // Strip wrapping quotes the model may add despite instructions.
  t = t.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '');
  // First line only, collapsed.
  t = t.split(/\r?\n/)[0] ?? '';
  t = t.replace(/\s+/g, ' ').trim();
  // Drop any trailing mix of sentence punctuation and closing quotes
  // (handles '"Title".' in one pass).
  t = t.replace(/[.,;:!?"'“”‘’]+$/, '').trim();
  if (t.length > MAX_TITLE_CHARS) {
    const cut = t.slice(0, MAX_TITLE_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    t = (lastSpace > 16 ? cut.slice(0, lastSpace) : cut).trim();
    t = t.replace(/[.,;:!?"'“”‘’]+$/, '').trim();
  }
  return t;
}

export async function maybeGenerateTitle(args: {
  caller: AiCaller;
  settings: AppSettings;
  campaign: Campaign;
  turn: Turn | null;
  getTemplate?: PromptTemplateGetter | null;
}): Promise<string | null> {
  if (!isAutoTitleDue(args.campaign)) return null;
  if (args.turn === null || args.turn.variants.length === 0) return null;
  const variant = args.turn.variants[args.turn.variants.length - 1];
  const playerInput = args.turn.playerInput.slice(0, 600);
  const synopsis = (variant.synopsis ?? '').slice(0, 600);
  const language = args.settings.language?.trim() || 'English';
  const userPrompt = buildTitleUserPrompt({ language, playerInput, synopsis });
  const systemPrompt = applyTemplate(
    resolveTitleSystemPrompt(args.getTemplate ?? null, language),
    { playerInput, synopsis },
  );

  let raw = '';
  try {
    for await (const chunk of args.caller.streamThink(systemPrompt, userPrompt)) {
      raw += chunk;
    }
  } catch {
    return null; // title is cosmetic; never fail the turn over it
  }
  const title = cleanTitle(raw);
  return title.length > 0 ? title : null;
}
