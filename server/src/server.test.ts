import { afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';

const servers: Server[] = [];

function listen(app: ReturnType<typeof createApp>): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      servers.push(server);
      const addr = server.address() as AddressInfo | null;
      if (addr) resolve(addr.port);
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
}

afterAll(() => {
  for (const s of servers) s.close();
});

describe('GET /api/health', () => {
  it('returns 200 and the expected shape', async () => {
    const port = await listen(createApp());
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);

    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, name: 'diegesis-web' });
    expect(typeof body['version']).toBe('string');
    expect((body['version'] as string).length).toBeGreaterThan(0);
  });

  it('reports the workspace package version', async () => {
    const port = await listen(createApp());
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = (await res.json()) as { version: string };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('unknown /api routes', () => {
  it('return a JSON 404', async () => {
    const port = await listen(createApp());
    const res = await fetch(`http://127.0.0.1:${port}/api/definitely-not-a-route`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
