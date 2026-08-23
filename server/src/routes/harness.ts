/**
 * Test harness shared by the API and SSE test files: temp data root per
 * suite, injected hub, and a FakeAiCaller factory — no network, no vitest
 * pickup (filename is not *.test.ts).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { createStorageHub, type StorageHub } from '../storage/hub.js';
import { FakeAiCaller, type FakeAiCallerOptions } from './fake-ai-caller.js';

export interface Harness {
  root: string;
  hub: StorageHub;
  fake: FakeAiCaller;
  app: ReturnType<typeof createApp>;
  listen(): Promise<number>;
  cleanup(): Promise<void>;
}

export async function createHarness(options?: {
  fakeOptions?: FakeAiCallerOptions;
  storedSettings?: Record<string, unknown>;
}): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'diegesis-api-'));
  const hub = createStorageHub(root);
  if (options?.storedSettings) {
    await hub.settings.save(options.storedSettings);
  }
  const fake = new FakeAiCaller(options?.fakeOptions);
  // The hub is passed into createApp below so tests can inspect files directly.
  const app = createApp({
    dataRoot: root,
    envFile: null,
    hub,
    aiCallerFactory: () => fake,
  });
  return {
    root,
    hub,
    fake,
    app,
    listen: () => listen(app),
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export function listen(app: ReturnType<typeof createApp>): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo | null;
      if (addr) resolve(addr.port);
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
}

export interface SseEvent {
  event: string;
  data: Record<string, unknown> | null;
}

/** Parses a complete SSE response body into named events. */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    let name: string | null = null;
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice('event: '.length);
      else if (line.startsWith('data: ')) data += line.slice('data: '.length);
    }
    if (name === null && data.length === 0) continue;
    events.push({ event: name ?? 'message', data: data.length > 0 ? JSON.parse(data) : null });
  }
  return events;
}

export async function readSse(res: globalThis.Response): Promise<SseEvent[]> {
  return parseSse(await res.text());
}
