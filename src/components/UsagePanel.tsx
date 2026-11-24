import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { getAllAccountsQuota, isTauriRuntime } from '../api/tauriClient';
import { useI18n } from '../i18n';
import type {
  AccountQuotaSnapshot,
  AccountSummary,
  QuotaDashboardSnapshot,
} from '../types/agent';
import { accountColor } from '../utils/colors';
import { parseModelVariant } from '../utils/modelGroups';

interface UsagePanelProps {
  demoMode: boolean;
  accounts: AccountSummary[];
  onOpenAccountSettings: () => void;
}

export function formatResetCountdown(resetTimeMs?: number | null): string {
  if (!resetTimeMs) return '';
  const diff = resetTimeMs - Date.now();
  if (diff <= 0) return '<1m';
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return mins > 0 ? `${mins}m` : '<1m';
}

function quotaColor(fraction: number): string {
  if (fraction < 0.2) return 'var(--red)';
  if (fraction < 0.5) return 'var(--amber)';
  return 'var(--green)';
}

function buildDemoQuotaSnapshot(accounts: AccountSummary[]): QuotaDashboardSnapshot {
  const now = Date.now();
  const list =
    accounts.length > 0
      ? accounts
      : [
          {
            id: 'demo-personal',
            label: 'Personal',
            email: 'personal@example.com',
            authenticated: true,
            hasSapisid: true,
            cookieCount: 19,
            authUser: 0,
            enabled: true,
            updatedAtMs: now,
          },
        ];
  return {
    fetchedAtMs: now,
    accounts: list.map((account, index) => ({
      accountId: account.id,
      accountLabel: account.label,
      email: account.email,
      planName: index === 0 ? 'Google AI Ultra' : 'Google AI Pro',
      userTier: index === 0 ? 'Ultra' : 'Pro',
      availablePromptCredits: index === 0 ? 420 : 85,
      monthlyPromptCredits: index === 0 ? 500 : 250,
      availableFlowCredits: index === 0 ? 1180 : 320,
      monthlyFlowCredits: index === 0 ? 1500 : 500,
      weeklyRemainingFraction: index === 0 ? 0.74 : 0.48,
      weeklyResetTimeMs: now + 4 * 24 * 3600 * 1000,
      onlineDevices: 1,
      totalDevices: 1,
      sourceDeviceName: 'Workstation',
      models: [
        {
          id: 'gemini-4-neon-high',
          displayName: 'Gemini 4 Neon (High)',
          description: 'Balanced coding & reasoning',
          remainingFraction: 0.88,
          resetTimeMs: now + 3 * 3600 * 1000,
          weeklyRemainingFraction: 0.78,
          weeklyResetTimeMs: now + 4 * 24 * 3600 * 1000,
          isDefault: true,
          disabled: false,
        },
        {
          id: 'claude-sonnet-5-5-medium',
          displayName: 'Claude Sonnet 5.5 (Medium)',
          description: 'Everyday software engineering',
          remainingFraction: 0.64,
          resetTimeMs: now + 2 * 3600 * 1000,
          weeklyRemainingFraction: 0.52,
          weeklyResetTimeMs: now + 4 * 24 * 3600 * 1000,
          isDefault: false,
          disabled: false,
        },
      ],
      errorCode: null,
      errorMessage: null,
      fetchedAtMs: now,
    })),
  };
}

function AccountUsage({
  item,
  onOpenAccountSettings,
}: {
  item: AccountQuotaSnapshot;
  onOpenAccountSettings: () => void;
}) {
  const { t, resolved } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const color = accountColor(item.accountId);
  const hasError = Boolean(item.errorCode);
  const errorText =
    item.errorCode === 'SESSION_EXPIRED'
      ? t('usageLoginExpired')
      : item.errorCode === 'NO_ONLINE_DEVICE'
        ? t('usageNoOnlineDevice')
        : t('usageUnavailable');

  // Deduplicate thinking-level variants into model families for a cleaner quota view.
  const groupedModels = useMemo(() => {
    const byFamily = new Map<string, (typeof item.models)[number]>();
    for (const model of item.models) {
      const family = parseModelVariant(model.displayName).familyName;
      const key = family.toLowerCase();
      const existing = byFamily.get(key);
      if (!existing) {
        byFamily.set(key, { ...model, displayName: family });
      } else {
        const nextFrac =
          typeof existing.remainingFraction === 'number' && typeof model.remainingFraction === 'number'
            ? Math.min(existing.remainingFraction, model.remainingFraction)
            : existing.remainingFraction ?? model.remainingFraction;
        const nextWeekly =
          typeof existing.weeklyRemainingFraction === 'number' &&
          typeof model.weeklyRemainingFraction === 'number'
            ? Math.min(existing.weeklyRemainingFraction, model.weeklyRemainingFraction)
            : existing.weeklyRemainingFraction ?? model.weeklyRemainingFraction;
        byFamily.set(key, {
          ...existing,
          remainingFraction: nextFrac,
          resetTimeMs: existing.resetTimeMs || model.resetTimeMs,
          weeklyRemainingFraction: nextWeekly,
          weeklyResetTimeMs: existing.weeklyResetTimeMs || model.weeklyResetTimeMs,
          isDefault: existing.isDefault || model.isDefault,
        });
      }
    }
    return Array.from(byFamily.values());
  }, [item.models]);

  const visibleModels = useMemo(() => {
    if (expanded) return groupedModels;
    const meaningful = groupedModels.filter(
      (model) =>
        model.isDefault ||
        typeof model.remainingFraction !== 'number' ||
        model.remainingFraction <= 0.95 ||
        (typeof model.weeklyRemainingFraction === 'number' && model.weeklyRemainingFraction <= 0.95)
    );
    return (meaningful.length > 0 ? meaningful : groupedModels).slice(0, 6);
  }, [expanded, groupedModels]);
  const hasMore = groupedModels.length > visibleModels.length;

  return (
    <section className="space-y-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ background: color }}
        >
          {(item.accountLabel || item.email || 'A').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[0.94rem] font-semibold truncate">{item.accountLabel}</span>
            {(item.planName || item.userTier) && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-medium"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Sparkles className="w-2.5 h-2.5" />
                {item.planName || item.userTier}
              </span>
            )}
          </div>
          <div className="text-[0.74rem] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {item.email || item.sourceDeviceName || '\u00a0'}
          </div>
        </div>
        {hasError && (
          <button
            type="button"
            onClick={onOpenAccountSettings}
            className="shrink-0 text-[0.74rem] font-semibold cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            {t('reauthBtn')}
          </button>
        )}
      </div>

      {hasError && (
        <div
          className="rounded-xl px-3 py-2.5 text-[0.78rem] flex items-start gap-2"
          style={{
            background: item.errorCode === 'SESSION_EXPIRED'
              ? 'rgba(220, 38, 38, 0.07)'
              : 'rgba(245, 158, 11, 0.08)',
            color: item.errorCode === 'SESSION_EXPIRED' ? 'var(--red)' : 'var(--amber)',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{errorText}</span>
        </div>
      )}

      {(typeof item.availablePromptCredits === 'number' ||
        typeof item.availableFlowCredits === 'number') && (
        <div className="grid grid-cols-2 gap-2.5">
          {typeof item.availablePromptCredits === 'number' && (
            <div>
              <div className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                {t('promptCreditsLabel')}
              </div>
              <div className="text-[1.05rem] font-semibold font-mono mt-0.5">
                {item.availablePromptCredits.toLocaleString()}
                {item.monthlyPromptCredits ? (
                  <span className="text-[0.72rem] font-normal" style={{ color: 'var(--text-muted)' }}>
                    {' / '}
                    {item.monthlyPromptCredits.toLocaleString()}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          {typeof item.availableFlowCredits === 'number' && (
            <div>
              <div className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                {t('flowCreditsLabel')}
              </div>
              <div className="text-[1.05rem] font-semibold font-mono mt-0.5">
                {item.availableFlowCredits.toLocaleString()}
                {item.monthlyFlowCredits ? (
                  <span className="text-[0.72rem] font-normal" style={{ color: 'var(--text-muted)' }}>
                    {' / '}
                    {item.monthlyFlowCredits.toLocaleString()}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {item.quotaGroups && item.quotaGroups.length > 0 && (
        <div className="space-y-3">
          {item.quotaDescription && (
            <p className="text-[0.74rem]" style={{ color: 'var(--text-muted)' }}>
              {item.quotaDescription}
            </p>
          )}
          {item.quotaGroups.map((group, gIdx) => (
            <div
              key={`${group.displayName}-${gIdx}`}
              className="rounded-xl border p-3 space-y-2.5"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
            >
              <div className="space-y-0.5">
                <div className="text-[0.82rem] font-semibold">{group.displayName}</div>
                {group.description && (
                  <div className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                    {group.description}
                  </div>
                )}
              </div>
              {group.buckets.length > 0 && (
                <div className="space-y-2.5">
                  {group.buckets.map((bucket) => {
                    const hasFrac = typeof bucket.remainingFraction === 'number';
                    const frac = hasFrac
                      ? Math.max(0, Math.min(1, bucket.remainingFraction!))
                      : 1;
                    const pct = Math.round(frac * 100);
                    const reset = formatResetCountdown(bucket.resetTimeMs);
                    return (
                      <div
                        key={bucket.bucketId}
                        className={`space-y-1.5 pt-2 first:pt-0 border-t first:border-t-0 ${
                          bucket.disabled ? 'opacity-50' : ''
                        }`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.78rem] font-medium truncate">
                            {bucket.displayName}
                          </span>
                          <span
                            className="text-[0.74rem] font-mono font-semibold shrink-0"
                            style={{ color: hasFrac ? quotaColor(frac) : 'var(--text-secondary)' }}
                          >
                            {hasFrac ? (pct <= 0 ? t('quotaExhaustedBadge') : `${pct}%`) : '—'}
                          </span>
                        </div>
                        {hasFrac && (
                          <div
                            className="h-1.5 rounded-full overflow-hidden"
                            style={{ background: 'var(--border-subtle)' }}
                          >
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(pct, 1)}%`,
                                background: quotaColor(frac),
                              }}
                            />
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 flex-wrap text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
                          {reset ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {t('quotaResetIn', { time: reset })}
                            </span>
                          ) : (
                            <span />
                          )}
                          {bucket.description && (
                            <span className="truncate">{bucket.description}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(!item.quotaGroups || item.quotaGroups.length === 0) && typeof item.weeklyRemainingFraction === 'number' && (
        <div
          className="rounded-xl border px-3 py-2.5 space-y-1.5"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.78rem] font-semibold">
              {resolved === 'en' ? 'Weekly Usage Limit' : '周用量限额'}
            </span>
            <span
              className="text-[0.74rem] font-mono font-semibold"
              style={{ color: quotaColor(item.weeklyRemainingFraction) }}
            >
              {Math.round(Math.max(0, Math.min(1, item.weeklyRemainingFraction)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(Math.round(Math.max(0, Math.min(1, item.weeklyRemainingFraction)) * 100), 1)}%`,
                background: quotaColor(item.weeklyRemainingFraction),
              }}
            />
          </div>
          {item.weeklyResetTimeMs && (
            <div className="flex items-center gap-1 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
              <Clock className="w-3 h-3" />
              {t('quotaResetIn', { time: formatResetCountdown(item.weeklyResetTimeMs) })}
            </div>
          )}
        </div>
      )}

      {groupedModels.length > 0 && (
        <div className="space-y-1.5">
          {visibleModels.map((model) => {
            const hasFraction = typeof model.remainingFraction === 'number';
            const fraction = hasFraction
              ? Math.max(0, Math.min(1, model.remainingFraction!))
              : 1;
            const percent = Math.round(fraction * 100);
            const reset = formatResetCountdown(model.resetTimeMs);
            const hasWeekly = typeof model.weeklyRemainingFraction === 'number';
            const weeklyFraction = hasWeekly
              ? Math.max(0, Math.min(1, model.weeklyRemainingFraction!))
              : 1;
            const weeklyPercent = Math.round(weeklyFraction * 100);
            const weeklyReset = formatResetCountdown(model.weeklyResetTimeMs);
            return (
              <div
                key={model.id}
                className="rounded-xl border px-3 py-2.5 space-y-2"
                style={{
                  borderColor:
                    (hasFraction && fraction < 0.2) || (hasWeekly && weeklyFraction < 0.2)
                      ? 'rgba(220, 38, 38, 0.22)'
                      : 'var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[0.8rem] font-medium truncate">{model.displayName}</span>
                    {model.isDefault && (
                      <span
                        className="text-[0.62rem] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}
                      >
                        Default
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[0.74rem] font-mono font-semibold shrink-0"
                    style={{ color: hasFraction ? quotaColor(fraction) : 'var(--text-secondary)' }}
                  >
                    {hasFraction
                      ? percent <= 0
                        ? t('quotaExhaustedBadge')
                        : `${resolved === 'en' ? '5h' : '5小时'} ${percent}%`
                      : '—'}
                  </span>
                </div>
                {hasFraction && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(percent, 1)}%`, background: quotaColor(fraction) }}
                      />
                    </div>
                    {reset && (
                      <div className="flex items-center gap-1 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="w-3 h-3" />
                        {resolved === 'en' ? '5h window · ' : '5小时窗口 · '}
                        {t('quotaResetIn', { time: reset })}
                      </div>
                    )}
                  </div>
                )}
                {hasWeekly && (
                  <div className="space-y-1 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between text-[0.7rem]">
                      <span style={{ color: 'var(--text-muted)' }}>
                        {resolved === 'en' ? 'Weekly limit' : '周用量'}
                      </span>
                      <span
                        className="font-mono font-semibold"
                        style={{ color: quotaColor(weeklyFraction) }}
                      >
                        {weeklyPercent <= 0 ? t('quotaExhaustedBadge') : `${weeklyPercent}%`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(weeklyPercent, 1)}%`, background: quotaColor(weeklyFraction) }}
                      />
                    </div>
                    {weeklyReset && (
                      <div className="flex items-center gap-1 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="w-3 h-3" />
                        {resolved === 'en' ? 'Weekly · ' : '周重置 · '}
                        {t('quotaResetIn', { time: weeklyReset })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full py-2 text-[0.75rem] font-medium cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {expanded ? t('usageShowLess') : t('usageShowAll', { count: groupedModels.length })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function UsagePanel({ demoMode, accounts, onOpenAccountSettings }: UsagePanelProps) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<QuotaDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const fetchQuota = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!isTauriRuntime() || demoMode) {
        setSnapshot(buildDemoQuotaSnapshot(accounts));
      } else {
        setSnapshot(await getAllAccountsQuota());
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [accounts, demoMode]);

  useEffect(() => {
    void fetchQuota();
  }, [fetchQuota]);

  const items = snapshot?.accounts || [];
  useEffect(() => {
    if (items.length === 0) {
      setSelectedAccountId('');
      return;
    }
    if (!items.some((item) => item.accountId === selectedAccountId)) {
      setSelectedAccountId(items[0].accountId);
    }
  }, [items, selectedAccountId]);
  const selectedItem =
    items.find((item) => item.accountId === selectedAccountId) || items[0] || null;
  const refreshed = snapshot?.fetchedAtMs
    ? new Date(snapshot.fetchedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.76rem] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {t('quotaDashboardSub')}
          {refreshed ? ` · ${refreshed}` : ''}
        </p>
        <button
          type="button"
          onClick={() => void fetchQuota()}
          disabled={loading}
          className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 cursor-pointer"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          aria-label={t('refreshUsage')}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl px-3 py-2.5 text-[0.78rem]"
          style={{ background: 'rgba(220, 38, 38, 0.07)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {loading && !snapshot ? (
        <div className="py-12 flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[0.82rem]">{t('quotaDashboardLoading')}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center space-y-3" style={{ color: 'var(--text-muted)' }}>
          <p className="text-[0.85rem]">{t('addAccountsCta')}</p>
          <button
            type="button"
            onClick={onOpenAccountSettings}
            className="px-3.5 h-9 rounded-lg text-[0.78rem] font-semibold cursor-pointer"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {t('accountsRow')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {items.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {items.map((item) => {
                const active = item.accountId === selectedItem?.accountId;
                return (
                  <button
                    key={item.accountId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedAccountId(item.accountId)}
                    className="inline-flex items-center gap-1.5 shrink-0 px-2.5 h-8 rounded-full text-[0.74rem] font-medium border cursor-pointer"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                      borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: accountColor(item.accountId) }}
                    />
                    {item.accountLabel}
                  </button>
                );
              })}
            </div>
          )}
          {selectedItem && (
            <AccountUsage item={selectedItem} onOpenAccountSettings={onOpenAccountSettings} />
          )}
        </div>
      )}
    </div>
  );
}
