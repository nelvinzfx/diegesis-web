/**
 * Retry helpers for Tencent Cloud MaaS request-admission rejections.
 *
 * The LLM Gateway load-balances the kimi-k3 alias across ~10 upstreams; the
 * Tencent Cloud upstream rejects requests at admission with code "400001" /
 * "The request is invalid: the request was rejected by an internal MaaS
 * component". The gateway re-routes per request, so a retry almost certainly
 * lands on a healthy upstream.
 *
 * Two distinct surfaces of the same rejection:
 *  - streaming (openai SDK 7.5.0): HTTP 200 transport with an in-stream SSE
 *    `event: error`; the SDK raises an APIError with `status: undefined` and
 *    `code: "400001"` — status-keyed retries cannot catch it, so we match on
 *    code/message instead.
 *  - non-streaming: a genuine HTTP 400 APIError carrying the same code/message.
 *
 * Pure helpers: no settings reads, no I/O — fully unit-testable.
 */

const MAAS_ERROR_CODE = '400001';
const MAAS_MESSAGE_MARKER = 'internal MaaS component';
/** 1 initial attempt + 2 retries = 3 total attempts. */
const MAAS_MAX_RETRIES = 2;

/**
 * True when `err` belongs to the Tencent MaaS admission-rejection class.
 * Matches on code or message, NOT on status: the streaming surface carries
 * `status: undefined`, the non-streaming surface a real HTTP 400 — both
 * carry the same code/message.
 */
export function isMaaSRejection(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (typeof candidate.code === 'string' && candidate.code === MAAS_ERROR_CODE) {
    return true;
  }
  return (
    typeof candidate.message === 'string' &&
    candidate.message.includes(MAAS_MESSAGE_MARKER)
  );
}

/** One-line, secret-free description for the retry warning. */
function describeMaaS(err: unknown): string {
  const e = err as {
    code?: unknown;
    message?: unknown;
    request_id?: unknown;
    error?: { request_id?: unknown } | null;
  };
  const parts: string[] = [];
  parts.push(`code=${typeof e.code === 'string' ? e.code : '<none>'}`);
  const requestId = e.request_id ?? e.error?.request_id;
  if (typeof requestId === 'string' && requestId.length > 0) {
    parts.push(`request_id=${requestId}`);
  }
  if (typeof e.message === 'string' && e.message.length > 0) {
    parts.push(`msg=${e.message.slice(0, 200)}`);
  }
  return parts.join(' ');
}

function warnMaaSRetry(err: unknown, attempt: number): void {
  console.warn(
    `[maas-retry] MaaS rejection after attempt ${attempt}/${MAAS_MAX_RETRIES + 1}; retrying on a fresh upstream (${describeMaaS(err)})`,
  );
}

/**
 * Wraps a streaming factory: retries the ENTIRE call (fresh create +
 * iteration) while a MaaS rejection arrives before ANY chunk has been yielded.
 * Once content has reached the consumer, or on any non-matching error, the
 * error propagates unchanged. Max MAAS_MAX_RETRIES retries. Consumer
 * early-exit (break/return) is a return completion, not a throw, and never
 * triggers a retry.
 */
export async function* streamWithMaaSRetry<T>(
  factory: () => AsyncGenerator<T>,
  shouldRetry: (err: unknown) => boolean = isMaaSRejection,
): AsyncGenerator<T> {
  for (let attempt = 0; ; attempt++) {
    let yieldedAny = false;
    try {
      for await (const item of factory()) {
        yieldedAny = true;
        yield item;
      }
      return;
    } catch (err) {
      if (yieldedAny || attempt >= MAAS_MAX_RETRIES || !shouldRetry(err)) {
        throw err;
      }
      warnMaaSRetry(err, attempt + 1);
    }
  }
}

/** Promise-path twin of streamWithMaaSRetry for non-streaming calls. */
export async function withMaaSRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean = isMaaSRejection,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAAS_MAX_RETRIES || !isMaaSRejection(err)) {
        throw err;
      }
      warnMaaSRetry(err, attempt + 1);
    }
  }
}
