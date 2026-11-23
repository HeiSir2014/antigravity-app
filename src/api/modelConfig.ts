import type { ModelOption } from '../types/agent';

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseTimeMs(raw: unknown): number | undefined {
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  } else if (raw && typeof raw === 'object') {
    const secs = Number((raw as { seconds?: number | string }).seconds);
    if (!Number.isNaN(secs) && secs > 0) return secs * 1000;
  }
  return undefined;
}

/**
 * Maps the official `GetCascadeModelConfigsResponse.clientModelConfigs` shape:
 * `{ label, modelOrAlias: { model | alias }, modelId, quotaInfo, disabled, ... }`.
 */
export function mapClientModelConfigs(raw: unknown): ModelOption[] {
  const obj = asObj(raw);
  const list = obj?.clientModelConfigs;
  if (!Array.isArray(list)) return [];

  return list
    .map((entry, idx): ModelOption | null => {
      const m = asObj(entry);
      if (!m) return null;
      const quota = asObj(m.quotaInfo);
      const weeklyObj = asObj(quota?.weeklyQuota) || asObj(quota?.longTermQuota) || asObj(m.weeklyQuotaInfo);
      const modelOrAlias = asObj(m.modelOrAlias) as
        | { model?: string; alias?: string }
        | undefined;
      const resetTimeMs = parseTimeMs(quota?.resetTime);
      const weeklyRemainingRaw =
        quota?.weeklyRemainingFraction ??
        weeklyObj?.remainingFraction ??
        m.weeklyRemainingFraction;
      const weeklyRemainingFraction =
        typeof weeklyRemainingRaw === 'number' ? weeklyRemainingRaw : undefined;
      const weeklyResetTimeMs = parseTimeMs(
        quota?.weeklyResetTime ?? weeklyObj?.resetTime ?? m.weeklyResetTime
      );
      const enumModel =
        typeof modelOrAlias?.model === 'string' && modelOrAlias.model.startsWith('MODEL_')
          ? modelOrAlias.model
          : undefined;
      const modelId = typeof m.modelId === 'string' ? m.modelId : undefined;
      const alias = typeof modelOrAlias?.alias === 'string' ? modelOrAlias.alias : undefined;
      return {
        id: modelId || enumModel || alias || `model-${idx}`,
        modelId,
        enumModel,
        displayName: String(m.label || m.displayName || alias || enumModel || `Model ${idx + 1}`),
        description: typeof m.description === 'string' ? m.description : undefined,
        remainingFraction:
          typeof quota?.remainingFraction === 'number' ? quota.remainingFraction : undefined,
        resetTimeMs,
        weeklyRemainingFraction,
        weeklyResetTimeMs,
        isDefault: Boolean(m.isRecommended || m.isDefault),
        disabled: Boolean(m.disabled),
      };
    })
    .filter((model): model is ModelOption => Boolean(model));
}
