/**
 * Minimal server-sent-events writer for the turn/plan streams.
 *
 * Event names used: stage {line}, reasoning {text}, token {text},
 * error {message}, done {...payload}.
 */

import type { Response } from 'express';

export function sseInit(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

export function sseSend(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sseEnd(res: Response): void {
  if (!res.writableEnded) res.end();
}
