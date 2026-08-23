/**
 * The real SDK-backed AiCaller — phase 2's replacement for the transport-free
 * phase 1 fakes. Implements the engine's AiCaller interface exactly:
 *
 *  - generateStructured: structuredWithRetry (engine) over a non-streaming
 *    THINK-model call; never throws for parse/transport problems.
 *  - streamThink: THINK model, streaming; reasoning deltas → hook, prose
 *    tokens → the iterable.
 *  - streamProse: WRITE model, streaming; prose only.
 *
 * Provider selection per StageModelSelection.provider: 'anthropic' takes the
 * @anthropic-ai/sdk path, everything else ('openai-compat', the default)
 * takes the OpenAI-compatible path via the `openai` SDK with configurable
 * baseURL.
 *
 * THINK-call extras come from the engine's thinkRequestExtras/ThinkingEffort:
 *  - openai-compat: top-level reasoning_effort on THINK calls only.
 *  - anthropic: thinking {type, budget_tokens} from ThinkingEffort,
 *    temperature omitted whenever thinking is attached.
 * max_tokens is derived from the effort level for THINK calls
 * (budget + 1024) and writeMaxTokens for prose.
 *
 * AbortSignal support: withSignal(signal) returns a scoped caller whose SDK
 * requests all carry the signal — the turn route aborts it on client
 * disconnect so stop-persists-partial works end to end.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AiCaller,
  ChatMessage,
  StreamHooks,
} from '../engine/ai-caller.js';
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI,
  structuredWithRetry,
  thinkRequestExtras,
} from '../engine/ai-caller.js';
import * as ThinkingEffort from '../engine/thinking-effort.js';
import type { AppSettings } from '../shared/types.js';

const PROSE_TEMPERATURE = 0.7;
const MISSING_KEY_PLACEHOLDER = 'missing-key';

type SettingsGetter = () => Promise<AppSettings>;

/** Reasoning deltas live outside the official chunk types on gateways. */
interface DeltaWithReasoning {
  content?: string | null;
  reasoning_content?: unknown;
  reasoning?: unknown;
}

function reasoningOf(delta: DeltaWithReasoning | undefined): string | null {
  if (!delta) return null;
  const raw = delta.reasoning_content ?? delta.reasoning;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export class DefaultAiCaller implements AiCaller {
  protected constructor(
    private readonly getSettings: SettingsGetter,
    private readonly signal: AbortSignal | null = null,
  ) {}

  static create(getSettings: SettingsGetter): DefaultAiCaller {
    return new DefaultAiCaller(getSettings, null);
  }

  /** Scoped view whose every provider request is bound to `signal`. */
  withSignal(signal: AbortSignal): DefaultAiCaller {
    return new DefaultAiCaller(this.getSettings, signal);
  }

  private requestOptions(): { signal?: AbortSignal } {
    return this.signal ? { signal: this.signal } : {};
  }

  private openaiClient(s: AppSettings): OpenAI {
    return new OpenAI({
      apiKey: s.openaiApiKey.length > 0 ? s.openaiApiKey : MISSING_KEY_PLACEHOLDER,
      baseURL: s.openaiBaseUrl.length > 0 ? s.openaiBaseUrl : undefined,
    });
  }

  private anthropicClient(s: AppSettings): Anthropic {
    return new Anthropic({
      apiKey: s.anthropicApiKey.length > 0 ? s.anthropicApiKey : MISSING_KEY_PLACEHOLDER,
    });
  }

  // ---- generateStructured -------------------------------------------

  async generateStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    decoder: (raw: string) => T,
    fallback: T,
  ): Promise<T> {
    return structuredWithRetry(
      systemPrompt,
      userPrompt,
      (messages) => this.completeThink(messages),
      decoder,
      fallback,
    );
  }

  /** Non-streaming THINK-model completion; null on transport failure. */
  private async completeThink(messages: readonly ChatMessage[]): Promise<string | null> {
    const s = await this.getSettings();
    if (s.thinkModel.provider === PROVIDER_ANTHROPIC) {
      const { customBody } = thinkRequestExtras(s, PROVIDER_ANTHROPIC, PROSE_TEMPERATURE);
      const thinking = customBody.find((b) => b.key === 'thinking')?.value as
        | Anthropic.ThinkingConfigParam
        | undefined;
      const response = await this.anthropicClient(s).messages.create(
        {
          model: s.thinkModel.model,
          max_tokens: ThinkingEffort.thinkMaxTokensFor(s.thinkingEffort),
          system: systemContent(messages),
          messages: chatMessages(messages),
          ...(thinking !== undefined ? { thinking } : { temperature: PROSE_TEMPERATURE }),
        },
        this.requestOptions(),
      );
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return text.length > 0 ? text : null;
    }

    const { customBody, temperature } = thinkRequestExtras(s, PROVIDER_OPENAI, PROSE_TEMPERATURE);
    const extras = Object.fromEntries(customBody.map((b) => [b.key, b.value]));
    const body = {
      model: s.thinkModel.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: ThinkingEffort.thinkMaxTokensFor(s.thinkingEffort),
      ...(temperature !== null ? { temperature } : {}),
      ...extras,
    };
    const response = await this.openaiClient(s).chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      this.requestOptions(),
    );
    const content = response.choices[0]?.message?.content ?? null;
    return typeof content === 'string' && content.length > 0 ? content : null;
  }

  // ---- streaming ----------------------------------------------------

  async *streamProse(
    systemPrompt: string,
    userPrompt: string,
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    const s = await this.getSettings();
    if (s.writeModel.provider === PROVIDER_ANTHROPIC) {
      yield* this.streamAnthropic(
        {
          model: s.writeModel.model,
          max_tokens: s.writeMaxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        hooks,
      );
      return;
    }
    yield* this.streamOpenAI(
      {
        model: s.writeModel.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: s.writeMaxTokens,
        stream: true,
        temperature: PROSE_TEMPERATURE,
      },
      hooks,
    );
  }

  async *streamThink(
    systemPrompt: string,
    userPrompt: string,
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    const s = await this.getSettings();
    if (s.thinkModel.provider === PROVIDER_ANTHROPIC) {
      const { customBody } = thinkRequestExtras(s, PROVIDER_ANTHROPIC, PROSE_TEMPERATURE);
      const thinking = customBody.find((b) => b.key === 'thinking')?.value as
        | Anthropic.ThinkingConfigParam
        | undefined;
      yield* this.streamAnthropic(
        {
          model: s.thinkModel.model,
          max_tokens: ThinkingEffort.thinkMaxTokensFor(s.thinkingEffort),
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          ...(thinking !== undefined ? { thinking } : {}),
        },
        hooks,
      );
      return;
    }
    const { customBody, temperature } = thinkRequestExtras(s, PROVIDER_OPENAI, PROSE_TEMPERATURE);
    const extras = Object.fromEntries(customBody.map((b) => [b.key, b.value]));
    yield* this.streamOpenAI(
      {
        model: s.thinkModel.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: ThinkingEffort.thinkMaxTokensFor(s.thinkingEffort),
        stream: true,
        ...(temperature !== null ? { temperature } : {}),
        ...extras,
      },
      hooks,
    );
  }

  private async *streamOpenAI(
    body: Record<string, unknown>,
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    const s = await this.getSettings();
    const stream = (await this.openaiClient(s).chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      this.requestOptions(),
    )) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as DeltaWithReasoning | undefined;
      if (!delta) continue;
      const reasoning = reasoningOf(delta);
      if (reasoning !== null) hooks?.onReasoningChunk?.(reasoning);
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield delta.content;
      }
    }
  }

  private async *streamAnthropic(
    params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
      thinking?: Anthropic.ThinkingConfigParam;
    },
    hooks?: StreamHooks,
  ): AsyncGenerator<string> {
    const s = await this.getSettings();
    const stream = (await this.anthropicClient(s).messages.create(
      {
        ...params,
        stream: true,
      },
      this.requestOptions(),
    )) as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      const delta = event.delta;
      if (delta.type === 'thinking_delta' && delta.thinking.length > 0) {
        hooks?.onReasoningChunk?.(delta.thinking);
      } else if (delta.type === 'text_delta' && delta.text.length > 0) {
        yield delta.text;
      }
    }
  }
}

function systemContent(messages: readonly ChatMessage[]): string {
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

function chatMessages(
  messages: readonly ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}
