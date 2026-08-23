/**
 * Live UNO smoke test — NOT part of vitest.
 *
 * One real streaming call against the UnoRouter OpenAI-compatible gateway.
 * The key is sourced from the environment only (shell: source $HOME/.env's
 * UNO variable); it is never read from or written to any repo file.
 *
 * Run from server/:
 *   KEY=$(grep '^UNO=' ~/.env | cut -d= -f2-)
 *   UNO="$KEY" node ../node_modules/tsx/dist/cli.mjs ../scripts/smoke-uno.ts
 */

import OpenAI from 'openai';

const BASE_URL = 'https://api.unorouter.com/v1';
const MODEL = 'deepseek-v4-flash-0731';

async function main(): Promise<void> {
  const apiKey = process.env.UNO;
  if (!apiKey || apiKey.length === 0) {
    console.error('FAIL: UNO environment variable is not set.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });
  const started = Date.now();
  let proseChunks = 0;
  let proseChars = 0;
  let reasoningChars = 0;
  let prose = '';

  const stream = (await client.chat.completions.create(
    {
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Greet me in exactly one short sentence.' },
      ],
      max_tokens: 2048,
      stream: true,
    },
    { timeout: 60_000 },
  )) as unknown as AsyncIterable<{
    choices?: Array<{ delta?: { content?: string | null; reasoning_content?: unknown; reasoning?: unknown } }>;
  }>;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    const reasoning = (delta as { reasoning_content?: unknown }).reasoning_content ??
      (delta as { reasoning?: unknown }).reasoning;
    if (typeof reasoning === 'string') reasoningChars += reasoning.length;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      proseChunks += 1;
      proseChars += delta.content.length;
      if (prose.length < 400) prose += delta.content;
    }
  }
  const elapsedMs = Date.now() - started;

  console.log(
    JSON.stringify(
      {
        base_url: BASE_URL,
        model: MODEL,
        ok: proseChars > 0,
        prose_token_chunks: proseChunks,
        prose_chars: proseChars,
        reasoning_present: reasoningChars > 0,
        reasoning_chars: reasoningChars,
        elapsed_ms: elapsedMs,
        first_200_chars: prose.slice(0, 200),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
