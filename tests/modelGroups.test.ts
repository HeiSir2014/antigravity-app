import { describe, expect, test } from 'bun:test';
import { groupModelsByFamily, matchRemoteModel, parseModelVariant } from '../src/utils/modelGroups';
import type { ModelOption } from '../src/types/agent';

describe('modelGroups', () => {
  test('parses model family name and compact thinking badge', () => {
    expect(parseModelVariant('Gemini 4 Neon (High)')).toEqual({
      familyName: 'Gemini 4 Neon',
      thinkingLevel: 'High',
      shortBadge: 'High',
      sortRank: 5,
    });
    expect(parseModelVariant('Gemini 4 Neon (Medium)')).toEqual({
      familyName: 'Gemini 4 Neon',
      thinkingLevel: 'Medium',
      shortBadge: 'Med',
      sortRank: 4,
    });
    expect(parseModelVariant('Claude Opus 4.6 (Thinking)')).toEqual({
      familyName: 'Claude Opus 4.6',
      thinkingLevel: 'Thinking',
      shortBadge: 'Think',
      sortRank: 4,
    });
    expect(parseModelVariant('Claude Sonnet 4.6')).toEqual({
      familyName: 'Claude Sonnet 4.6',
      thinkingLevel: null,
      shortBadge: null,
      sortRank: 1,
    });
  });

  test('groups flat catalog variants by family and sorts effort ascending', () => {
    const catalog: ModelOption[] = [
      { id: 'g4-high', enumModel: 'MODEL_G4_HIGH', displayName: 'Gemini 4 Neon (High)', remainingFraction: 0.7 },
      { id: 'g4-low', enumModel: 'MODEL_G4_LOW', displayName: 'Gemini 4 Neon (Low)', remainingFraction: 0.9 },
      { id: 'g4-med', enumModel: 'MODEL_G4_MED', displayName: 'Gemini 4 Neon (Medium)', remainingFraction: 0.8, isDefault: true },
      { id: 'c-sonnet', enumModel: 'MODEL_CLAUDE_SONNET', displayName: 'Claude Sonnet 4.6', remainingFraction: 0.95 },
    ];

    const groups = groupModelsByFamily(catalog);
    expect(groups.length).toBe(2);
    expect(groups[0].familyName).toBe('Gemini 4 Neon');
    expect(groups[0].variants.map((v) => v.parsed.thinkingLevel)).toEqual(['Low', 'Medium', 'High']);
    expect(groups[0].isDefault).toBe(true);
    expect(groups[0].remainingFraction).toBe(0.7);
    expect(groups[1].familyName).toBe('Claude Sonnet 4.6');
  });

  test('matches remote session enum or modelId to catalog entry', () => {
    const catalog: ModelOption[] = [
      { id: 'g4-med', modelId: 'gemini-4-neon-med', enumModel: 'MODEL_G4_MED', displayName: 'Gemini 4 Neon (Medium)' },
    ];
    expect(matchRemoteModel('MODEL_G4_MED', catalog)?.displayName).toBe('Gemini 4 Neon (Medium)');
    expect(matchRemoteModel('gemini-4-neon-med', catalog)?.displayName).toBe('Gemini 4 Neon (Medium)');
    expect(matchRemoteModel('unknown', catalog)).toBeNull();
  });
});
