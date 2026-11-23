import type { ModelOption } from '../types/agent';

export interface ParsedModelVariant {
  familyName: string;
  thinkingLevel: string | null;
  shortBadge: string | null;
  sortRank: number;
}

export interface ModelFamilyGroup {
  familyName: string;
  description?: string;
  variants: Array<{
    option: ModelOption;
    parsed: ParsedModelVariant;
  }>;
  remainingFraction?: number;
  resetTimeMs?: number;
  weeklyRemainingFraction?: number;
  weeklyResetTimeMs?: number;
  isDefault: boolean;
  disabled: boolean;
}

const THINKING_PAREN_RE = /\s*\(([^)]+)\)\s*$/;

const LEVEL_MAP: Record<string, { label: string; short: string; rank: number }> = {
  off: { label: 'Off', short: 'Off', rank: 0 },
  none: { label: 'Off', short: 'Off', rank: 0 },
  standard: { label: 'Standard', short: 'Std', rank: 1 },
  minimal: { label: 'Minimal', short: 'Min', rank: 2 },
  min: { label: 'Minimal', short: 'Min', rank: 2 },
  low: { label: 'Low', short: 'Low', rank: 3 },
  medium: { label: 'Medium', short: 'Med', rank: 4 },
  med: { label: 'Medium', short: 'Med', rank: 4 },
  high: { label: 'High', short: 'High', rank: 5 },
  max: { label: 'Max', short: 'Max', rank: 6 },
  xhigh: { label: 'Max', short: 'Max', rank: 6 },
  thinking: { label: 'Thinking', short: 'Think', rank: 4 },
  'thinking low': { label: 'Low', short: 'Low', rank: 3 },
  'thinking medium': { label: 'Medium', short: 'Med', rank: 4 },
  'thinking high': { label: 'High', short: 'High', rank: 5 },
  'thinking max': { label: 'Max', short: 'Max', rank: 6 },
};

/**
 * Splits a full model display name (e.g. `Gemini 4 Neon (High)` or `Claude Opus 4.6 (Thinking)`)
 * into its base model family name and normalized thinking level badge.
 */
export function parseModelVariant(displayName: string): ParsedModelVariant {
  const trimmed = (displayName || '').trim();
  const match = THINKING_PAREN_RE.exec(trimmed);
  if (match) {
    const rawInside = match[1].trim();
    const key = rawInside.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const mapped = LEVEL_MAP[key];
    if (mapped) {
      const familyName = trimmed.slice(0, match.index).trim() || trimmed;
      return {
        familyName,
        thinkingLevel: mapped.label,
        shortBadge: mapped.short,
        sortRank: mapped.rank,
      };
    }
  }

  // Handle suffix without parens like "Claude 4.5 Sonnet Thinking"
  const suffixMatch = /\s+(Thinking|Minimal|Low|Medium|High|Max)$/i.exec(trimmed);
  if (suffixMatch) {
    const key = suffixMatch[1].toLowerCase();
    const mapped = LEVEL_MAP[key];
    if (mapped) {
      const familyName = trimmed.slice(0, suffixMatch.index).trim() || trimmed;
      return {
        familyName,
        thinkingLevel: mapped.label,
        shortBadge: mapped.short,
        sortRank: mapped.rank,
      };
    }
  }

  return {
    familyName: trimmed,
    thinkingLevel: null,
    shortBadge: null,
    sortRank: 1,
  };
}

/**
 * Groups flat model catalog entries by base model family, sorting thinking levels
 * inside each family from lowest to highest effort.
 */
export function groupModelsByFamily(models: ModelOption[]): ModelFamilyGroup[] {
  const byFamily = new Map<string, ModelFamilyGroup>();
  const order: string[] = [];

  for (const option of models) {
    const parsed = parseModelVariant(option.displayName);
    const key = parsed.familyName.toLowerCase();
    let group = byFamily.get(key);
    if (!group) {
      group = {
        familyName: parsed.familyName,
        description: option.description,
        variants: [],
        remainingFraction: option.remainingFraction,
        resetTimeMs: option.resetTimeMs,
        weeklyRemainingFraction: option.weeklyRemainingFraction,
        weeklyResetTimeMs: option.weeklyResetTimeMs,
        isDefault: Boolean(option.isDefault),
        disabled: Boolean(option.disabled),
      };
      byFamily.set(key, group);
      order.push(key);
    }
    group.variants.push({ option, parsed });
    if (option.isDefault) group.isDefault = true;
    if (!option.disabled) group.disabled = false;
    if (!group.description && option.description) group.description = option.description;
    if (typeof option.remainingFraction === 'number') {
      group.remainingFraction =
        typeof group.remainingFraction === 'number'
          ? Math.min(group.remainingFraction, option.remainingFraction)
          : option.remainingFraction;
    }
    if (typeof option.resetTimeMs === 'number' && !group.resetTimeMs) {
      group.resetTimeMs = option.resetTimeMs;
    }
    if (typeof option.weeklyRemainingFraction === 'number') {
      group.weeklyRemainingFraction =
        typeof group.weeklyRemainingFraction === 'number'
          ? Math.min(group.weeklyRemainingFraction, option.weeklyRemainingFraction)
          : option.weeklyRemainingFraction;
    }
    if (typeof option.weeklyResetTimeMs === 'number' && !group.weeklyResetTimeMs) {
      group.weeklyResetTimeMs = option.weeklyResetTimeMs;
    }
  }

  return order.map((key) => {
    const group = byFamily.get(key)!;
    group.variants.sort((a, b) => a.parsed.sortRank - b.parsed.sortRank);
    return group;
  });
}

/**
 * Resolves a raw model identifier (enum, modelId, alias, or displayName) returned by
 * remote session trajectory metadata to a matching catalog ModelOption.
 */
export function matchRemoteModel(
  rawIdentifier: string | undefined | null,
  availableModels: ModelOption[]
): ModelOption | null {
  const needle = (rawIdentifier || '').trim();
  if (!needle || availableModels.length === 0) return null;
  const lower = needle.toLowerCase();
  return (
    availableModels.find(
      (m) =>
        m.enumModel?.toLowerCase() === lower ||
        m.modelId?.toLowerCase() === lower ||
        m.id.toLowerCase() === lower ||
        m.displayName.toLowerCase() === lower
    ) || null
  );
}
