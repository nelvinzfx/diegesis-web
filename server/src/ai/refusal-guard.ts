/**
 * Refusal gate for streamed prose.
 *
 * Some upstreams (or the model itself) answer a story request with an
 * out-of-character refusal essay instead of narration ("[Out of character]",
 * "I can't generate...", "explicit sexual description is outside...").
 * The refusal reveals itself in the first few hundred characters, so we
 * buffer the prefix, sniff it, and throw a retryable error BEFORE anything
 * reaches the client — the caller's retry wrapper then re-rolls the upstream
 * and the reader never sees the refusal.
 *
 * Pure helpers, no I/O, no settings reads.
 */

import { isMaaSRejection } from './maas-retry.js';

export const SCENE_REFUSAL_CODE = 'scene_refusal';

/** True for every retryable generation failure: upstream rejection OR an
 * in-content refusal essay caught by the prefix guard. */
export function isSceneRetryable(err: unknown): boolean {
  return isMaaSRejection(err) || err instanceof SceneRefusalError;
}

export class SceneRefusalError extends Error {
  readonly code = SCENE_REFUSAL_CODE;
  constructor(message = 'scene generation was refused by the provider') {
    super(message);
    this.name = 'SceneRefusalError';
  }
}

/**
 * True when the start of a text looks like a refusal/meta-answer rather than
 * narration. Deliberately keyed on the prefix: refusals announce themselves
 * immediately. In-fiction characters saying "no" is narration, not refusal.
 */
export function isRefusalText(text: string): boolean {
  const head = text.trimStart().toLowerCase();
  if (head.length === 0) return false;

  // OOC/meta openers.
  if (
    head.startsWith('[out of character') ||
    head.startsWith('*[out of character') ||
    head.startsWith('(ooc') ||
    head.startsWith('[ooc') ||
    head.startsWith('ooc:')
  ) {
    return true;
  }

  // Assistant-voice markers in the opening window.
  const window = head.slice(0, 400);
  const markers = [
    "i can't",
    'i cannot',
    "i won't",
    'i will not',
    "i'm not able to",
    'i am not able to',
    'cannot generate',
    "can't generate",
    'cannot help',
    "can't help",
    'cannot provide',
    'cannot fulfill',
    'not something i can',
    'outside what',
    'as an ai',
    'content policy',
    'content guidelines',
    'against my guidelines',
    'explicit sexual description is outside',
    'no matter what',
    "no matter what's typed",
  ];
  return markers.some((m) => window.includes(m));
}

/**
 * Buffers the first `minChars` characters of a prose stream. If the buffered
 * prefix is refusal-shaped, throws SceneRefusalError WITHOUT yielding anything
 * (safe for the caller's retry wrapper: zero chunks emitted). Otherwise yields
 * the buffer, then passes the remaining chunks through live.
 */
export async function* guardRefusalPrefix(
  source: AsyncGenerator<string>,
  minChars = 200,
): AsyncGenerator<string> {
  let buffer = '';
  const iterator = source[Symbol.asyncIterator]();
  while (buffer.length < minChars) {
    const next = await iterator.next();
    if (next.done) break;
    buffer += next.value;
  }
  if (isRefusalText(buffer)) {
    throw new SceneRefusalError();
  }
  if (buffer.length > 0) yield buffer;
  while (true) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}
