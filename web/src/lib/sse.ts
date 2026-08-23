/**
 * Fetch-based SSE client.
 *
 * EventSource cannot POST, so this hand-rolls the wire format:
 * frames of `event: <name>\n` / `data: <json>\n` lines separated by a blank
 * line. The server (server/src/routes/sse.ts) emits exactly that shape with
 * events: stage {line}, reasoning {text}, token {text}, error {message},
 * done {...payload}.
 *
 * Design notes:
 * - Line-oriented incremental parser (`createSseParser`): pure string in,
 *   events out. Survives chunk boundaries anywhere, including mid-line and
 *   a CRLF split across two chunks (the split degrades to bare CR + bare
 *   LF; the stray blank line is a harmless no-op at dispatch time).
 * - Comments (`:` prefix) are ignored per the SSE spec; only `event:` and
 *   `data:` fields are consumed. A frame dispatches when data is non-empty.
 * - `sseFetch` resolves on a terminal event ("done" or "error"), on clean
 *   stream end, or on abort; it never throws for an "error" event, callers
 *   inspect the returned terminal payload instead. AbortController support
 *   flows straight through to fetch.
 */

export interface SseEvent {
  /** Event name; defaults to "message" when the sender omits it. */
  event: string;
  /** Raw (still JSON-encoded) data payload joined across data: lines. */
  data: string;
}

export type SseEventHandler = (event: SseEvent) => void;

const LINE_BREAK = /\r\n|\n|\r/;

export function createSseParser(onEvent: SseEventHandler): {
  push: (chunk: string) => void;
  end: () => void;
} {
  let buffer = '';
  let pendingEvent = 'message';
  const dataLines: string[] = [];

  function handleLine(line: string): void {
    if (line.startsWith(':')) return; // comment / keep-alive
    if (line.length === 0) {
      // Blank line terminates a frame.
      if (dataLines.length > 0) {
        onEvent({ event: pendingEvent, data: dataLines.join('\n') });
      }
      pendingEvent = 'message';
      dataLines.length = 0;
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      pendingEvent = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // Other fields (id:, retry:) are intentionally ignored.
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      // The regex alternation matches CRLF as one break when both halves are
      // present. A CRLF split across chunks degrades to "bare CR" + "bare LF":
      // the stray LF becomes an extra blank line, which at worst flushes an
      // already-flushed frame (a no-op: dispatch needs non-empty data).
      const parts = buffer.split(LINE_BREAK);
      buffer = parts.pop() ?? '';
      for (const line of parts) handleLine(line);
    },
    end(): void {
      if (buffer.length > 0) {
        const rest = buffer;
        buffer = '';
        handleLine(rest);
      }
      handleLine(''); // flush a final unterminated frame
    },
  };
}

export interface SseTerminalEvent {
  event: 'done' | 'error';
  data: unknown;
}

export interface SseFetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Called for every parsed event except nothing; all events pass here. */
  onEvent: (event: string, data: unknown) => void;
}

export interface SseFetchResult {
  /** True when the stream ended because opts.signal aborted. */
  aborted: boolean;
  /** Payload of the done/error event when one arrived before the stream closed. */
  terminal: SseTerminalEvent | null;
}

export async function sseFetch(url: string, options: SseFetchOptions): Promise<SseFetchResult> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { accept: 'text/event-stream', ...options.headers },
    body: options.body,
    signal: options.signal,
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // body unreadable; keep empty detail
    }
    throw new Error(`SSE request failed (${response.status}): ${detail || response.statusText}`);
  }
  if (!response.body) {
    throw new Error('SSE request failed: response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((evt) => {
    let data: unknown = evt.data;
    try {
      data = JSON.parse(evt.data);
    } catch {
      // Non-JSON payloads pass through as strings.
    }
    options.onEvent(evt.event, data);
    if (evt.event === 'done' || evt.event === 'error') {
      terminal = { event: evt.event as 'done' | 'error', data };
    }
  });

  let terminal: SseTerminalEvent | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode()); // flush multi-byte sequences split at EOF
    parser.end();
  } catch (error) {
    if (options.signal?.aborted) {
      return { aborted: true, terminal };
    }
    throw error;
  }

  return { aborted: options.signal?.aborted === true, terminal };
}
