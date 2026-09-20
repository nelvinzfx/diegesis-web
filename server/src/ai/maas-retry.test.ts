import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isMaaSRejection,
  streamWithMaaSRetry,
  withMaaSRetry,
} from './maas-retry.js';

/** The Tencent MaaS admission rejection, as the openai SDK surfaces it. */
function maasRejection(extra: Record<string, unknown> = {}): Error {
  return Object.assign(
    new Error(
      'The request is invalid: the request was rejected by an internal MaaS component (system). Please try again.',
    ),
    { code: '400001', status: undefined, request_id: 'req-123', ...extra },
  );
}

/** Consume a generator to completion, capturing items and any error. */
async function collect<T>(
  gen: AsyncGenerator<T>,
): Promise<{ items: T[]; error: unknown }> {
  const items: T[] = [];
  try {
    for await (const item of gen) items.push(item);
  } catch (err) {
    return { items, error: err };
  }
  return { items, error: undefined };
}

describe('isMaaSRejection', () => {
  it('matches the streaming surface: code 400001, status undefined', () => {
    expect(isMaaSRejection({ code: '400001', status: undefined })).toBe(true);
  });

  it('matches the message marker with status undefined and no code', () => {
    expect(
      isMaaSRejection({
        status: undefined,
        message: 'The request is invalid: the request was rejected by an internal MaaS component (system).',
      }),
    ).toBe(true);
  });

  it('matches the non-streaming surface: HTTP 400 APIError with the code', () => {
    expect(
      isMaaSRejection({
        status: 400,
        code: '400001',
        message: 'The request is invalid: the request was rejected by an internal MaaS component (system).',
      }),
    ).toBe(true);
  });

  it('rejects ordinary errors', () => {
    expect(isMaaSRejection(new Error('boom'))).toBe(false);
    expect(isMaaSRejection(new TypeError('cannot read properties'))).toBe(false);
  });

  it('rejects plain 400s with other codes', () => {
    expect(
      isMaaSRejection({
        status: 400,
        code: 'invalid_request_error',
        message: 'Bad Request',
      }),
    ).toBe(false);
  });

  it('rejects non-objects and non-string codes', () => {
    expect(isMaaSRejection(null)).toBe(false);
    expect(isMaaSRejection('400001')).toBe(false);
    expect(isMaaSRejection(42)).toBe(false);
    expect(isMaaSRejection({ code: 400001 })).toBe(false);
  });
});

describe('streamWithMaaSRetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries the entire call while nothing has been yielded', async () => {
    let calls = 0;
    const factory = (): AsyncGenerator<string> => {
      calls++;
      if (calls <= 2) {
        return (async function* () {
          throw maasRejection();
        })();
      }
      return (async function* () {
        yield 'a';
        yield 'b';
      })();
    };

    const { items, error } = await collect(streamWithMaaSRetry(factory));
    expect(items).toEqual(['a', 'b']);
    expect(error).toBeUndefined();
    expect(calls).toBe(3);
  });

  it('never retries after partial content reached the consumer', async () => {
    let calls = 0;
    const factory = (): AsyncGenerator<string> => {
      calls++;
      return (async function* () {
        yield 'x';
        throw maasRejection();
      })();
    };

    const { items, error } = await collect(streamWithMaaSRetry(factory));
    expect(items).toEqual(['x']);
    expect(isMaaSRejection(error)).toBe(true);
    expect(calls).toBe(1);
  });

  it('propagates non-matching errors after a single call', async () => {
    let calls = 0;
    const boom = new Error('boom');
    const factory = (): AsyncGenerator<string> => {
      calls++;
      return (async function* () {
        throw boom;
      })();
    };

    const { items, error } = await collect(streamWithMaaSRetry(factory));
    expect(items).toEqual([]);
    expect(error).toBe(boom);
    expect(calls).toBe(1);
  });

  it('gives up and throws after exactly 3 attempts on persistent rejection', async () => {
    let calls = 0;
    const factory = (): AsyncGenerator<string> => {
      calls++;
      return (async function* () {
        throw maasRejection();
      })();
    };

    const { error } = await collect(streamWithMaaSRetry(factory));
    expect(isMaaSRejection(error)).toBe(true);
    expect(calls).toBe(3);
  });
});

describe('withMaaSRetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries MaaS rejections and resolves the eventual value', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls++;
      if (calls <= 2) throw maasRejection();
      return 'ok';
    };

    await expect(withMaaSRetry(fn)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('propagates non-matching errors after a single call', async () => {
    let calls = 0;
    const boom = new Error('boom');
    const fn = async (): Promise<string> => {
      calls++;
      throw boom;
    };

    await expect(withMaaSRetry(fn)).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it('gives up and throws after exactly 3 attempts on persistent rejection', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls++;
      throw maasRejection();
    };

    await expect(withMaaSRetry(fn)).rejects.toSatisfy(isMaaSRejection);
    expect(calls).toBe(3);
  });

  it('warns once per retry with code and request_id, no secrets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = async (): Promise<string> => {
      throw maasRejection();
    };

    await expect(withMaaSRetry(fn)).rejects.toSatisfy(isMaaSRejection);
    expect(warn).toHaveBeenCalledTimes(2);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('400001');
    expect(line).toContain('req-123');
    expect(line).not.toContain('sk-');
  });
});
