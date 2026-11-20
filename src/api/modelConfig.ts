import type { ModelOption } from '../types/agent';

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
      const quota = asObj(m.quotaInfo) as
        | { remainingFraction?: number; resetTime?: string | { seconds?: number | string } }
        | null;
      const modelOrAlias = asObj(m.modelOrAlias) as
        | { model?: string; alias?: string }
        | undefined;
      let resetTimeMs: number | undefined;
      if (typeof quota?.resetTime === 'string') {
        const parsed = Date.parse(quota.resetTime);
        if (!Number.isNaN(parsed)) resetTimeMs = parsed;
      } else if (quota?.resetTime && typeof quota.resetTime === 'object') {
        const secs = Number(quota.resetTime.seconds);
        if (!Number.isNaN(secs) && secs > 0) resetTimeMs = secs * 1000;
      }
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
        isDefault: Boolean(m.isRecommended || m.isDefault),
        disabled: Boolean(m.disabled),
      };
    })
    .filter((model): model is ModelOption => Boolean(model));
}
