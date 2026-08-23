/**
 * Express app assembly: storage singletons + AiCaller with injectable
 * factories (tests pass temp data roots and fake callers), route mounting,
 * .env bootstrap, and the phase-0 SPA/static shell.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import type { AiCaller } from './engine/ai-caller.js';
import { PipelineOrchestrator } from './engine/orchestrator.js';
import { DefaultAiCaller } from './ai/default-ai-caller.js';
import { createStorageHub, type StorageHub } from './storage/hub.js';
import { SettingsService, publicSettingsView } from './server/settings-service.js';
import {
  applyToProcessEnv,
  envProviderDefaults,
  loadDotEnvFile,
} from './server/env.js';
import type { AppSettings } from './shared/types.js';
import type { RouteContext } from './routes/context.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerCampaignRoutes } from './routes/campaigns.js';
import { registerNpcRoutes } from './routes/npcs.js';
import { registerMemoryRoutes } from './routes/memories.js';
import { registerTurnRoutes } from './routes/turns.js';
import { registerPlanRoute } from './routes/plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
const defaultEnvFile = path.resolve(here, '../.env');

export type AiCallerFactory = (getSettings: () => Promise<AppSettings>) => AiCaller;

export interface CreateAppOptions {
  /** Data root for the storage layer; default `./data` (server cwd). */
  dataRoot?: string;
  /** server/.env path; `null` skips .env loading entirely (tests). */
  envFile?: string | null;
  /** Override the AiCaller implementation (tests inject fakes). */
  aiCallerFactory?: AiCallerFactory;
  /** Storage hub override (defaults to a hub over dataRoot). */
  hub?: StorageHub;
}

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

export function createApp(options: CreateAppOptions = {}): express.Express {
  // ---- .env bootstrap (PORT etc. land in process.env; provider keys become
  // settings defaults that settings.json always overrides once set).
  if (options.envFile !== null) {
    applyToProcessEnv(loadDotEnvFile(options.envFile ?? defaultEnvFile));
  }

  const dataRoot = options.dataRoot ?? path.resolve(process.cwd(), 'data');
  const hub = options.hub ?? createStorageHub(dataRoot);
  const settingsService = new SettingsService(hub.settings, envProviderDefaults(process.env));
  const aiCallerFactory: AiCallerFactory =
    options.aiCallerFactory ?? ((getSettings) => DefaultAiCaller.create(getSettings));
  const baseCaller = aiCallerFactory(() => settingsService.get());

  const ctx: RouteContext = {
    hub,
    settingsService,
    effectiveSettings: () => settingsService.get(),
    aiCaller: async () => baseCaller,
    createOrchestrator: (caller, orchestratorOptions) =>
      new PipelineOrchestrator({ aiCaller: caller, stores: hub.stores, ...orchestratorOptions }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  // Raw body for PNG card import (content-type detected in the route).
  app.use(express.raw({ type: ['image/png', 'application/octet-stream'], limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'diegesis-web', version: pkgVersion() });
  });

  const api = Router();
  registerSettingsRoutes(api, ctx);
  registerCampaignRoutes(api, ctx);
  registerNpcRoutes(api, ctx);
  registerMemoryRoutes(api, ctx);
  registerTurnRoutes(api, ctx);
  registerPlanRoute(api, ctx);
  app.use('/api', api);

  // Unknown /api routes: JSON 404, never the SPA fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  // JSON error responses for body-parse failures and handler rejections.
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const isParseError =
        typeof error === 'object' &&
        error !== null &&
        (error as { type?: string }).type === 'entity.parse.failed';
      const message = error instanceof Error ? error.message : String(error);
      res
        .status(isParseError ? 400 : 500)
        .json({ ok: false, error: isParseError ? 'invalid_json' : 'internal_error', message });
    },
  );

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

// Kept importable for scripts that only need the redacted view.
export { publicSettingsView };
