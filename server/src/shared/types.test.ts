import { describe, expect, it } from 'vitest';
import { defaultAppSettings, defaultNpcAgency, defaultSceneState } from './types.js';

/**
 * The Android app serializes these models with kotlinx-serialization using the
 * property names verbatim (snake_case only where declared so in Kotlin).
 * These tests pin the exact JSON field names so data files stay portable.
 */
describe('shared model JSON field names', () => {
  it('AppSettings defaults match AppSettings.kt exactly', () => {
    const s = defaultAppSettings();
    expect(s.thinkModel).toEqual({ provider: 'openai-compat', model: 'gpt-4o-mini' });
    expect(s.writeModel).toEqual({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
    expect(s.openaiBaseUrl).toBe('https://api.openai.com/v1');
    expect(s.openaiApiKey).toBe('');
    expect(s.anthropicApiKey).toBe('');
    expect(s.language).toBe('English');
    expect(s.thinkingEffort).toBe('medium');
    expect(s.writeMaxTokens).toBe(8192);
    expect(s.contextWindowTokens).toBe(32768);
  });

  it('pipeline models serialize with the Android field names', () => {
    // Keys that MUST appear verbatim in serialized output:
    const routerDecisionKeys = ['needs_check', 'checks', 'run_agency_update', 'lore_query'];
    void routerDecisionKeys;

    const decision = {
      needs_check: true,
      checks: [{ skill: 'stealth', dc: 5, modifier: 0, advantage: 0 }],
      run_agency_update: false,
      lore_query: null,
    };
    expect(Object.keys(decision).sort()).toEqual(
      ['checks', 'lore_query', 'needs_check', 'run_agency_update'].sort(),
    );

    const plot = {
      synopsis: 's',
      present_npcs: [],
      scene_change: false,
      location: null,
      tracker_updates: [{ npc: 'a', key: 'trust', delta: -1 }],
    };
    expect(Object.keys(plot)).toContain('present_npcs');
    expect(Object.keys(plot)).toContain('scene_change');
    expect(Object.keys(plot.tracker_updates[0])).toEqual(['npc', 'key', 'delta']);
  });

  it('NpcAgency uses will_act_on snake_case while Npc uses camelCase fields', () => {
    const agency = defaultNpcAgency();
    expect('will_act_on' in agency).toBe(true);
    expect('willActOn' in agency).toBe(false);

    const npc = {
      id: 'x',
      name: 'X',
      description: '',
      personality: '',
      voiceExamples: [],
      agency,
      trackers: {},
      sourceCard: null,
    };
    expect(Object.keys(npc).sort()).toEqual(
      ['agency', 'description', 'id', 'name', 'personality', 'sourceCard', 'trackers', 'voiceExamples'].sort(),
    );
  });

  it('TurnVariant carries stageEvents and reasoning with Android names and defaults', () => {
    const variant = {
      id: 'v',
      synopsis: 's',
      sceneOutput: 'o',
      routerDecision: null,
      presentNpcIds: [] as string[],
      mechanicResults: [],
      interrupted: false,
      timestamp: 0,
      stageEvents: [] as string[],
      reasoning: null as string | null,
    };
    expect('stageEvents' in variant).toBe(true);
    expect('reasoning' in variant).toBe(true);
    expect(variant.stageEvents).toEqual([]);
    expect(variant.reasoning).toBeNull();
  });

  it('SceneState default is blank', () => {
    expect(defaultSceneState()).toEqual({ location: '', presentNpcIds: [] });
  });
});
