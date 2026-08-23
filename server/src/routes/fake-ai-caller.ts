/**
 * Injectable AiCaller fake for route/SSE tests: no network, deterministic
 * stage outputs. generateStructured returns intentionally-undecodable raw
 * text unless configured, so every structured stage exercises its documented
 * fallback path.
 */

import type { AiCaller, StreamHooks } from '../engine/ai-caller.js';

export interface FakeAiCallerOptions {
  /** Raw strings handed to decoders, in call order (cycled). Default: junk. */
  structuredRaw?: string[];
  proseChunks?: string[];
  thinkChunks?: string[];
  /** Emitted via onReasoningChunk before the first prose/think chunk. */
  reasoningChunks?: string[];
  /** Throw after this many prose chunks (scene interrupt path). */
  failProseAfterChunks?: number | null;
  /** Throw after this many think chunks (plan error path). */
  failThinkAfterChunks?: number | null;
  /** Yield prose chunks, then block until the scoped signal aborts. */
  hangProseUntilAbort?: boolean;
}

export class FakeAiCaller implements AiCaller {
  readonly structuredCalls: string[] = [];
  readonly signals: AbortSignal[] = [];
  private structuredIndex = 0;
  private proseEmitted = 0;

  constructor(private readonly options: FakeAiCallerOptions = {}) {}

  /** Mirrors DefaultAiCaller.withSignal so routes scope aborts to it. */
  withSignal(signal: AbortSignal): FakeAiCaller {
    this.signals.push(signal);
    return this;
  }

  async generateStructured<T>(
    _systemPrompt: string,
    _userPrompt: string,
    decoder: (raw: string) => T,
    fallback: T,
  ): Promise<T> {
    const pool = this.options.structuredRaw ?? ['not-json-at-all'];
    const raw = pool[this.structuredIndex % pool.length];
    this.structuredIndex += 1;
    this.structuredCalls.push(raw);
    try {
      return decoder(raw);
    } catch {
      return fallback;
    }
  }

  async *streamProse(
    _systemPrompt: string,
    _userPrompt: string,
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    yield* this.stream(this.options.proseChunks ?? ['Scene prose.'], hooks, 'prose');
  }

  async *streamThink(
    _systemPrompt: string,
    _userPrompt: string,
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    yield* this.stream(this.options.thinkChunks ?? ['Plan text.'], hooks, 'think');
  }

  private async *stream(
    chunks: string[],
    hooks: StreamHooks | undefined,
    kind: 'prose' | 'think',
  ): AsyncGenerator<string> {
    for (const reasoning of this.options.reasoningChunks ?? []) {
      hooks?.onReasoningChunk?.(reasoning);
    }
    const failAfter = kind === 'prose' ? this.options.failProseAfterChunks : this.options.failThinkAfterChunks;
    let emittedThisStream = 0;
    for (const chunk of chunks) {
      if (
        failAfter !== null &&
        failAfter !== undefined &&
        emittedThisStream >= failAfter
      ) {
        throw new Error('stream aborted');
      }
      emittedThisStream += 1;
      this.proseEmitted += 1;
      yield chunk;
    }
    if (kind === 'prose' && this.options.hangProseUntilAbort === true) {
      const signal = this.signals[this.signals.length - 1];
      if (signal && !signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      throw new Error('stream aborted');
    }
  }
}
