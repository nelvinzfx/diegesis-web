import { describe, expect, it } from 'vitest';

import { createSseParser, type SseEvent } from './sse';

function collect(): { events: SseEvent[]; parser: ReturnType<typeof createSseParser> } {
  const events: SseEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  return { events, parser };
}

describe('sseFetch', () => {
  it('sends a JSON content-type header when a string body is present', async () => {
    // Regression: without it express.json skipped the body and every SSE
    // POST (turns/plan/opening) 400'd — za could not send a single turn.
    let seenContentType: string | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seenContentType = new Headers(init?.headers).get('content-type');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    try {
      const { sseFetch } = await import('./sse');
      const result = await sseFetch('/x', { method: 'POST', body: '{"a":1}', onEvent: () => {} });
      expect(seenContentType).toBe('application/json');
      expect(result.terminal?.event).toBe('done');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('createSseParser', () => {
  it('parses a well-formed frame', () => {
    const { events, parser } = collect();
    parser.push('event: stage\ndata: {"line":"router: ok"}\n\n');
    expect(events).toEqual([{ event: 'stage', data: '{"line":"router: ok"}' }]);
  });

  it('parses multiple frames in one chunk', () => {
    const { events, parser } = collect();
    parser.push(
      'event: token\ndata: {"text":"a"}\n\n' +
        'event: token\ndata: {"text":"b"}\n\n' +
        'event: done\ndata: {}\n\n',
    );
    expect(events.map((e) => e.event)).toEqual(['token', 'token', 'done']);
  });

  it('reassembles a frame split mid-line across chunks', () => {
    const { events, parser } = collect();
    parser.push('event: rea');
    parser.push('soning\ndata: {"te');
    parser.push('xt":"partial thought"}');
    parser.push('\n\n');
    expect(events).toEqual([{ event: 'reasoning', data: '{"text":"partial thought"}' }]);
  });

  it('handles CRLF line endings including a CRLF split across chunks', () => {
    const { events, parser } = collect();
    parser.push('event: stage\r\ndata: {"line":"x"}\r');
    parser.push('\n\r\n');
    expect(events).toEqual([{ event: 'stage', data: '{"line":"x"}' }]);
  });

  it('handles bare CR line endings', () => {
    const { events, parser } = collect();
    parser.push('event: token\rdata: {"text":"c"}\r\r');
    expect(events).toEqual([{ event: 'token', data: '{"text":"c"}' }]);
  });

  it('ignores comment lines and unknown fields', () => {
    const { events, parser } = collect();
    parser.push(': keep-alive ping\nid: 7\nretry: 3000\nevent: stage\ndata: {"line":"y"}\n\n');
    expect(events).toEqual([{ event: 'stage', data: '{"line":"y"}' }]);
  });

  it('joins multiple data lines with newline and resets state between frames', () => {
    const { events, parser } = collect();
    parser.push('data: first\ndata: second\n\n');
    parser.push('data: third\n\n');
    expect(events).toEqual([
      { event: 'message', data: 'first\nsecond' },
      { event: 'message', data: 'third' },
    ]);
  });

  it('does not dispatch a frame with an event name but no data', () => {
    const { events, parser } = collect();
    parser.push('event: noop\n\n');
    expect(events).toEqual([]);
    // State must reset: next default-event frame still works.
    parser.push('data: plain\n\n');
    expect(events).toEqual([{ event: 'message', data: 'plain' }]);
  });

  it('flushes a final unterminated frame on end()', () => {
    const { events, parser } = collect();
    parser.push('event: error\ndata: {"message":"boom"}\n');
    parser.end();
    expect(events).toEqual([{ event: 'error', data: '{"message":"boom"}' }]);
  });

  it('survives byte-at-a-time delivery of a full exchange', () => {
    const { events, parser } = collect();
    const wire =
      'event: stage\ndata: {"line":"plot: ok"}\n\n' +
      'event: token\ndata: {"text":"The door opens."}\n\n' +
      'event: done\ndata: {"turn":{"index":0}}\n\n';
    for (const ch of wire) parser.push(ch);
    parser.end();
    expect(events.map((e) => e.event)).toEqual(['stage', 'token', 'done']);
    expect(JSON.parse(events[2].data)).toEqual({ turn: { index: 0 } });
  });
});
