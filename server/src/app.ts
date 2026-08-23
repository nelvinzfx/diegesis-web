import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

export function pkgVersion(): string {
  try {
    const raw = readFileSync(path.resolve(here, '../package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.length > 0
      ? parsed.version
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'diegesis-web', version: pkgVersion() });
  });

  // Unknown /api routes: JSON 404, never the SPA fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  // Serve the built SPA when present.
  app.use(express.static(webDist));

  // SPA fallback for client-side routes; JSON 404 for anything else.
  app.use((req, res) => {
    if (req.method === 'GET') {
      res.sendFile(path.join(webDist, 'index.html'), (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ ok: false, error: 'not_found' });
        }
      });
      return;
    }
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  return app;
}
