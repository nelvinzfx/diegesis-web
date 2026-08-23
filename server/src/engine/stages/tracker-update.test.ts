/**
 * Unit tests for the narrative status board stage: decode strictness,
 * fence/prose tolerance via generateStructured, presence filtering, and
 * handling of an empty previous board.
 */

import { describe, expect, it } from 'vitest';

import { sanitize, type AiCaller } from '../ai-caller.js';
import {
  buildUserPrompt,
  decodeTrackerEntry,
  decodeTrackerState,
  execute,
  resolveSystemPrompt,
} from './tracker-update.js';
import type { TrackerNpcInput } from './tracker-update.js';

function callerReturning(raw: string): AiCaller {
  return {
    async generateStructured<T>(
      _systemPrompt: string,
      _userPrompt: string,
      decoder: (text: string) => T,
      fallback: T,
    ): Promise<T> {
      try {
        // Mirror the real caller: fence/prose sanitize before decode.
        return decoder(sanitize(raw));
      } catch {
        return fallback;
      }
    },
    // Unused by this stage.
    // eslint-disable-next-line require-yield
    async *streamProse(): AsyncGenerator<string> {
      throw new Error('not used');
    },
    // eslint-disable-next-line require-yield
    async *streamThink(): AsyncGenerator<string> {
      throw new Error('not used');
    },
  };
}

const PRESENT: TrackerNpcInput[] = [
  { id: 'alice', name: 'Alice', description: 'Harbor fixer.' },
  { id: 'bob', name: 'Bob', description: 'Deck hand.' },
];

const BASE_INPUT = {
  previous: null,
  synopsis: 'Alice confronts Zane.',
  sceneOutput: 'The scene prose.',
  location: 'Kota Tua',
  presentNpcs: PRESENT,
  playerPersona: 'Zane, quiet observer.',
  language: 'English',
};

const VALID_RAW = JSON.stringify({
  dateTime: 'Rabu, 17 Desember, 16:51',
  location: 'Kota Tua',
  atmosphere: 'Hujan tipis, lampu sodium.',
  player: { look: 'hoodie gelap', condition: 'napas berat', carrying: 'ponsel' },
  npcs: {
    alice: { look: 'jaket peach', condition: 'tenang', carrying: '-', innerVoice: '"Lepas semua."' },
    bob: { look: '-', condition: '-', carrying: '-' },
    ghost: { look: 'stale', condition: 'stale', carrying: 'stale' },
  },
});

describe('tracker-update stage', () => {
  it('decodes valid JSON, filters to present NPCs only, keeps optional innerVoice', async () => {
    const state = await execute(callerReturning(VALID_RAW), BASE_INPUT);
    expect(state).not.toBeNull();
    expect(state!.dateTime).toBe('Rabu, 17 Desember, 16:51');
    expect(state!.atmosphere).toBe('Hujan tipis, lampu sodium.');
    expect(state!.player).toEqual({ look: 'hoodie gelap', condition: 'napas berat', carrying: 'ponsel' });
    // ghost was returned by the model but is NOT present in the scene.
    expect(Object.keys(state!.npcs)).toEqual(['alice', 'bob']);
    expect(state!.npcs['alice']!.innerVoice).toBe('"Lepas semua."');
    expect(state!.npcs['bob']!.innerVoice).toBeUndefined();
    // The orchestrator stamps the turn; the stage leaves it null.
    expect(state!.updatedAtTurn).toBeNull();
  });

  it('returns null on garbage output so the caller keeps the previous state', async () => {
    const state = await execute(callerReturning('totally not json'), BASE_INPUT);
    expect(state).toBeNull();
  });

  it('tolerates fenced JSON with leading prose (sanitize path)', async () => {
    const fenced = 'Here is the board:\n```json\n' + VALID_RAW + '\n```\nDone.';
    const state = await execute(callerReturning(fenced), BASE_INPUT);
    expect(state).not.toBeNull();
    expect(state!.location).toBe('Kota Tua');
  });

  it('handles an empty previous board by saying so in the prompts', () => {
    const system = resolveSystemPrompt(null, BASE_INPUT);
    const user = buildUserPrompt(BASE_INPUT);
    expect(system).toContain('status board');
    expect(user).toContain('(none yet: this is the first board)');
    expect(user).toContain('id: alice | name: Alice');
    expect(user).toContain('Story language: English');
  });

  it('formats a non-null previous board into the prompt', () => {
    const user = buildUserPrompt({
      ...BASE_INPUT,
      previous: {
        dateTime: 'earlier',
        location: 'elsewhere',
        atmosphere: 'calm',
        player: null,
        npcs: {},
        updatedAtTurn: 3,
      },
    });
    expect(user).toContain('"dateTime":"earlier"');
    expect(user).not.toContain('(none yet');
  });

  it('decode throws on structurally invalid payloads', () => {
    expect(() => decodeTrackerState('[]')).toThrow();
    expect(() => decodeTrackerState('{}')).toThrow(/dateTime/);
    expect(() =>
      decodeTrackerState(JSON.stringify({ dateTime: 'd', location: 'l', atmosphere: 'a', npcs: {} })),
    ).not.toThrow();
    expect(() =>
      decodeTrackerEntry({ look: 'x', condition: 'y', carrying: 'z', innerVoice: 42 }),
    ).toThrow(/innerVoice/);
  });
});
