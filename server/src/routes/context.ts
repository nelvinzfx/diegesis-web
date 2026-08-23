/**
 * Shared route context + small express helpers.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PipelineOrchestrator } from '../engine/orchestrator.js';
import type { OrchestratorStores } from '../engine/orchestrator.js';
import type { AiCaller } from '../engine/ai-caller.js';
import type { AppSettings } from '../shared/types.js';
import type { StorageHub } from '../storage/hub.js';
import type { SettingsService } from '../server/settings-service.js';

export interface RouteContext {
  hub: StorageHub;
  settingsService: SettingsService;
  /** Effective BYOK settings (settings.json layered over .env bootstrap). */
  effectiveSettings: () => Promise<AppSettings>;
  /** The singleton base caller; routes scope it per-request via withSignal. */
  aiCaller: () => Promise<AiCaller>;
  /**
   * Builds a pipeline orchestrator with a fresh prompt-template snapshot
   * (async so overrides are read per request, no ambient singletons).
   */
  createOrchestrator: (
    caller: AiCaller,
    options: { contextWindowTokens?: number; writeMaxTokens?: number },
  ) => Promise<PipelineOrchestrator>;
}

/**
 * Express 5 types params as `string | string[]`; routes want plain strings.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value.join('/') : (value ?? '');
}

/** Forward async handler rejections to the JSON error middleware. */
export function wrap(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

/**
 * Binds the caller to the request's AbortSignal when the implementation
 * supports it (DefaultAiCaller does); fakes without withSignal pass through.
 */
export function scopeToRequest(base: AiCaller, signal: AbortSignal): AiCaller {
  const candidate = base as AiCaller & { withSignal?: (s: AbortSignal) => AiCaller };
  return typeof candidate.withSignal === 'function' ? candidate.withSignal(signal) : base;
}

// Re-exported for route modules' convenience.
export type { OrchestratorStores };
