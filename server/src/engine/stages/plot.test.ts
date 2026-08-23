/**
 * Plot stage tension + contract placement tests.
 *
 * CONTRACT PROPERTY: the JSON output-format instruction lives in the
 * code-built user payload (buildUserPayload), never in the overridable
 * system template. A template override must not be able to break parsing.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SYSTEM_PROMPT,
  FALLBACK_SYNOPSIS,
  buildUserPayload,
  decodePlotOutput,
  plotFallback,
} from './plot.js';

describe('plot tension parsing', () => {
  const base = {
    synopsis: 'Something happens.',
    present_npcs: [],
    scene_change: false,
    location: null,
    tracker_updates: [],
  };

  it('passes the three valid values through', () => {
    for (const tension of ['escalate', 'hold', 'release']) {
      expect(decodePlotOutput(JSON.stringify({ ...base, tension })).tension).toBe(tension);
    }
  });

  it('missing tension decodes as null', () => {
    expect(decodePlotOutput(JSON.stringify(base)).tension).toBeNull();
  });

  it('invalid tension values decode as null without failing the parse', () => {
    expect(decodePlotOutput(JSON.stringify({ ...base, tension: 'burst' })).tension).toBeNull();
    expect(decodePlotOutput(JSON.stringify({ ...base, tension: 'ESCALATE' })).tension).toBeNull();
    expect(decodePlotOutput(JSON.stringify({ ...base, tension: 3 })).tension).toBeNull();
    expect(decodePlotOutput(JSON.stringify({ ...base, tension: null })).tension).toBeNull();
    // The rest of the output is unaffected.
    const decoded = decodePlotOutput(JSON.stringify({ ...base, tension: 'burst' }));
    expect(decoded.synopsis).toBe('Something happens.');
    expect(decoded.tracker_updates).toEqual([]);
  });

  it('the fallback output carries no tension', () => {
    expect(plotFallback.tension).toBeNull();
    expect(plotFallback.synopsis).toBe(FALLBACK_SYNOPSIS);
  });
});

describe('plot output contract placement', () => {
  it('the JSON contract lives in the user payload, not the default template', () => {
    const user = buildUserPayload('I look around.', [], []);
    expect(user).toContain('Reply with JSON:');
    expect(user).toContain('"tension"');
    // The template keeps only generic guidance ("Reply with JSON only."),
    // never the contract shape itself.
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('Reply with JSON:');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('"tension"');
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('"synopsis"');
  });

  it('the default template guides pacing instead of demanding maximum conflict', () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('MAXIMUM CONFLICT');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('escalate');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('release');
  });

  it('renders a Recent tension section only when history is non-empty', () => {
    const withHistory = buildUserPayload('go', [], [], [
      'turn 0: escalate',
      'turn 2: release',
    ]);
    expect(withHistory).toContain('## Recent tension');
    expect(withHistory).toContain('- turn 0: escalate');
    expect(withHistory).toContain('- turn 2: release');

    const withoutHistory = buildUserPayload('go', [], []);
    expect(withoutHistory).not.toContain('## Recent tension');
    // The contract is present either way.
    expect(withoutHistory).toContain('Reply with JSON:');
  });
});
