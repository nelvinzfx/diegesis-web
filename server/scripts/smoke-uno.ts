/**
 * Live UnoRouter smoke test (not part of vitest — costs tokens).
 * Run: cd server && KEY=$(grep '^UNO=' ~/.env | cut -d= -f2-) && \
 *      node ../node_modules/tsx/dist/cli.mjs scripts/smoke-uno.ts
 * The key is passed via env only; never written to any repo file.
 */
import OpenAI from 'openai';

async function main(): Promise<void> {
  const apiKey = process.env.UNO_SMOKE_KEY;
  if (!apiKey) {
    console.error('UNO_SMOKE_KEY not set — source it from ~/.env');
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.unorouter.com/v1',
  });

  const stream = await client.chat.completions.create({
    model: 'deepseek-v4-flash-0731',
    stream: true,
    max_tokens: 200,
    messages: [
      { role: 'system', content: 'You are terse. Answer in one short paragraph.' },
      { role: 'user', content: 'Say hi and name your favorite color.' },
    ],
  });

  let text = '';
  let reasoning = '';
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta as {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    if (delta.content) text += delta.content;
    if (delta.reasoning_content) reasoning += delta.reasoning_content;
    else if (delta.reasoning) reasoning += delta.reasoning;
  }

  console.log('status: OK');
  console.log(`text chars: ${text.length}`);
  console.log(`text head: ${JSON.stringify(text.slice(0, 200))}`);
  console.log(`reasoning present: ${reasoning.length > 0} (${reasoning.length} chars)`);
}

main().catch((err: unknown) => {
  console.error('smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
