import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT, resolveSystemPrompt } from './agency.js';
import type { Npc } from '../../shared/types.js';

const npc: Npc = {
  id: 'alice',
  name: 'Alice',
  description: 'A dockside fixer with expensive tastes.',
  personality: 'Wary, charming, always counting.',
  voiceExamples: [],
  firstMessage: '',
  agency: { goal: 'get paid', stance: 'intrigued', will_act_on: 'nothing yet' },
  trackers: {},
  sourceCard: null,
};

const witnessed = '**Player:** go';

describe('agency resolveSystemPrompt', () => {
  it('default prompt keeps NPC appetites alive ahead of the JSON contract', () => {
    const prompt = resolveSystemPrompt(null, npc, witnessed);
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).toContain('their own appetites');
    expect(prompt).toContain('Reply with JSON only');
    expect(prompt.indexOf('their own appetites')).toBeLessThan(prompt.indexOf('Reply with JSON only'));
  });
});
