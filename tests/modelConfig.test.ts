import { describe, expect, test } from 'bun:test';
import { mapClientModelConfigs } from '../src/api/modelConfig';

describe('mapClientModelConfigs', () => {
  test('maps official label/modelOrAlias/quota fields and sends enum', () => {
    const models = mapClientModelConfigs({
      clientModelConfigs: [
        {
          label: 'Gemini 3 Pro',
          modelOrAlias: { model: 'MODEL_GOOGLE_GEMINI_3_PRO' },
          quotaInfo: { remainingFraction: 0.42, resetTime: { seconds: 1_700_000_000 } },
          isRecommended: true,
          disabled: false,
        },
        {
          label: 'Fast alias',
          modelOrAlias: { alias: 'fast' },
          modelId: 'fast-id',
        },
        {
          label: 'Disabled model',
          modelOrAlias: { model: 'MODEL_DISABLED' },
          disabled: true,
        },
      ],
    });

    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({
      id: 'MODEL_GOOGLE_GEMINI_3_PRO',
      enumModel: 'MODEL_GOOGLE_GEMINI_3_PRO',
      displayName: 'Gemini 3 Pro',
      remainingFraction: 0.42,
      resetTimeMs: 1_700_000_000_000,
      isDefault: true,
      disabled: false,
    });
    expect(models[1]?.id).toBe('fast-id');
    expect(models[1]?.enumModel).toBeUndefined();
    expect(models[2]?.disabled).toBe(true);
  });

  test('ignores malformed responses', () => {
    expect(mapClientModelConfigs(null)).toEqual([]);
    expect(mapClientModelConfigs({ clientModelConfigs: 'nope' })).toEqual([]);
  });
});
