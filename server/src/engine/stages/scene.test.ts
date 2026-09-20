import { describe, expect, it } from 'vitest';
import { DEFAULT_NARRATOR_VOICE, resolveSystemPrompt } from './scene.js';
import type { SceneContext } from '../visibility.js';

const context: SceneContext = {
  synopsis: 'She turns.',
  tension: null,
  location: 'The Docks',
  mechanicOutcomes: [],
  presentNpcs: [
    {
      id: 'alice',
      name: 'Alice',
      description: '',
      personality: '',
      voiceExamples: [],
      agency: '',
      trackers: {},
    },
  ],
  filteredHistory: [],
  retrievedMemories: [],
  playerInput: 'go',
};

describe('scene resolveSystemPrompt', () => {
  it('uses the default narrator voice verbatim when no template override exists', () => {
    expect(resolveSystemPrompt(null, context)).toBe(DEFAULT_NARRATOR_VOICE);
  });

  it('default narrator voice directs NPCs to act on their own initiative', () => {
    expect(DEFAULT_NARRATOR_VOICE).toContain('act on their own initiative');
    expect(resolveSystemPrompt(null, context)).toContain('act on their own initiative');
  });
});
