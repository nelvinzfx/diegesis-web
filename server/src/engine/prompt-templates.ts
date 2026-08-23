/**
 * Prompt template plumbing: stage keys, {{variable}} interpolation, and the
 * injected-getter contract used by every AI stage.
 *
 * A stage asks its injected getter for an override by stage key. Null means
 * "use the hardcoded default". Interpolation replaces {{variable}} tokens
 * with values the stage provides; a variable the stage does not supply
 * renders as its literal {{text}} (never crashes).
 */

export const STAGE_KEYS = [
  'router',
  'plot',
  'agency',
  'scene',
  'memory-extraction',
  'session-plan',
  'title',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export function isStageKey(value: string): value is StageKey {
  return (STAGE_KEYS as readonly string[]).includes(value);
}

/** Sync getter the stages receive; null = no override for that key. */
export type PromptTemplateGetter = (stageKey: StageKey) => string | null;

/** Snapshot-based getter factory (overrides loaded once per request/turn). */
export function getterFromOverrides(
  overrides: Record<string, string>,
): PromptTemplateGetter {
  return (stageKey) => {
    const value = overrides[stageKey];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
}

/** Variables each stage's template may reference. Keep this list short. */
export const STAGE_VARIABLES: Record<StageKey, readonly string[]> = {
  router: ['playerInput', 'location', 'presentNpcs'],
  plot: ['sessionPlan', 'storySoFar'],
  agency: ['npcName', 'npcDescription', 'personality', 'goal', 'stance', 'willActOn', 'witnessed'],
  scene: ['playerInput', 'synopsis', 'location', 'presentNpcs'],
  'memory-extraction': ['playerInput', 'synopsis', 'sceneOutput'],
  'session-plan': ['title', 'premise', 'playerPersona'],
  title: ['maxChars', 'language', 'playerInput', 'synopsis'],
};

/** Variable names referenced by a template body ({{token}} tokens). */
export function referencedVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Replace {{variable}} placeholders with provided values. Unknown variables
 * stay as literal text so a typo degrades gracefully instead of throwing.
 */
export function applyTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = variables[name];
    return typeof value === 'string' ? value : match;
  });
}

/** Resolve a stage's system prompt: override wins, else the shipped default. */
export function resolvePrompt(
  getTemplate: PromptTemplateGetter | null | undefined,
  stageKey: StageKey,
  defaultValue: string,
  variables: Record<string, string>,
): string {
  const override = getTemplate?.(stageKey) ?? null;
  return applyTemplate(override ?? defaultValue, variables);
}
