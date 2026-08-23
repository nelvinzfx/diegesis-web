import { describe, expect, it } from 'vitest';

import {
  applyTemplate,
  getterFromOverrides,
  isStageKey,
  referencedVariables,
  STAGE_KEYS,
  STAGE_VARIABLES,
} from './prompt-templates.js';

describe('prompt template interpolation', () => {
  it('replaces provided variables', () => {
    expect(
      applyTemplate('Hello {{playerInput}} at {{location}}', {
        playerInput: 'open the door',
        location: 'The Docks',
      }),
    ).toBe('Hello open the door at The Docks');
  });

  it('leaves unknown variables as literal text instead of crashing', () => {
    expect(applyTemplate('uses {{nope}} and {{playerInput}}', { playerInput: 'x' })).toBe(
      'uses {{nope}} and x',
    );
  });

  it('lists referenced variables sorted and unique', () => {
    expect(referencedVariables('{{b}} {{a}} {{a}} plain {{c1_d}}')).toEqual(['a', 'b', 'c1_d']);
    expect(referencedVariables('no variables here')).toEqual([]);
  });

  it('snapshot getter returns overrides only for non-empty strings', () => {
    const get = getterFromOverrides({ scene: 'custom voice {{playerInput}}', plot: '' });
    expect(get('scene')).toBe('custom voice {{playerInput}}');
    expect(get('plot')).toBeNull();
    expect(get('router')).toBeNull();
  });

  it('declares every stage key with its variable list', () => {
    expect(STAGE_KEYS).toEqual([
      'router',
      'plot',
      'agency',
      'scene',
      'memory-extraction',
      'session-plan',
      'title',
      'opening',
    ]);
    expect(STAGE_VARIABLES.opening).toEqual([
      'title',
      'premise',
      'sessionPlan',
      'location',
      'playerPersona',
      'presentNpcs',
      'language',
    ]);
    for (const key of STAGE_KEYS) {
      expect(isStageKey(key)).toBe(true);
      expect(STAGE_VARIABLES[key].length).toBeGreaterThan(0);
    }
    expect(isStageKey('bogus')).toBe(false);
  });
});
