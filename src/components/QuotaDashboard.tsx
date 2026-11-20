import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { getAllAccountsQuota, isTauriRuntime } from '../api/tauriClient';
import { useI18n } from '../i18n';
import type { AccountQuotaSnapshot, AccountSummary, QuotaDashboardSnapshot } from '../types/agent';
import { accountColor } from '../utils/colors';

interface QuotaDashboardProps {
  open: boolean;
  demoMode: boolean;
  accounts: AccountSummary[];
  onClose: () => void;
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
  if (mins > 0) return `${mins}m`;
  return '<1m';
}

function buildDemoQuotaSnapshot(accounts: AccountSummary[]): QuotaDashboardSnapshot {
  const now = Date.now();
  const baseAccounts =
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
          {
            id: 'demo-work',
            label: 'Work',
            email: 'work@example.com',
            authenticated: true,
            hasSapisid: true,
            cookieCount: 18,
            authUser: 0,
            enabled: true,
            updatedAtMs: now,
          },
        ];

  return {
    fetchedAtMs: now,
    accounts: baseAccounts.map((acc, idx) => ({
      accountId: acc.id,
      accountLabel: acc.label,
      email: acc.email || `${acc.label.toLowerCase()}@gmail.com`,
      planName: idx === 0 ? 'Google AI Ultra' : 'Google AI Pro',
      userTier: idx === 0 ? 'Ultra' : 'Pro',
      availablePromptCredits: idx === 0 ? 420 : 85,
      monthlyPromptCredits: idx === 0 ? 500 : 250,
      availableFlowCredits: idx === 0 ? 1180 : 320,
      monthlyFlowCredits: idx === 0 ? 1500 : 500,
      onlineDevices: idx === 0 ? 2 : 1,
      totalDevices: idx === 0 ? 2 : 1,
      sourceDeviceName: idx === 0 ? 'MacBook Pro' : 'Linux-DevBox',
      models: [
        {
          id: 'gemini-4-neon',
          displayName: 'Gemini 4 Neon',
          description: 'Fast balanced coding & reasoning',
          remainingFraction: idx === 0 ? 0.88 : 0.42,
          resetTimeMs: now + 3 * 3600 * 1000 + 25 * 60 * 1000,
          isDefault: true,
          disabled: false,
        },
        {
          id: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon',
          description: 'Deep architecture & debugging',
          remainingFraction: idx === 0 ? 0.64 : 0.0,
          resetTimeMs: now + 1 * 3600 * 1000 + 18 * 60 * 1000,
          isDefault: false,
          disabled: false,
        },
        {
          id: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6',
          description: 'Everyday software engineering',
          remainingFraction: idx === 0 ? 0.94 : 0.12,
          resetTimeMs: now + 4 * 3600 * 1000 + 5 * 60 * 1000,
          isDefault: false,
          disabled: false,
        },
        {
          id: 'claude-opus-4-6',
          displayName: 'Claude Opus 4.6',
          description: 'Maximum reasoning depth',
          remainingFraction: idx === 0 ? 0.0 : 0.76,
          resetTimeMs: now + 2 * 3600 * 1000 + 42 * 60 * 1000,
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

function quotaColor(fraction: number): string {
  if (fraction <= 0.001) return 'var(--red)';
  if (fraction < 0.2) return 'var(--red)';
  if (fraction < 0.5) return 'var(--amber)';
  return 'var(--green)';
}

function CreditBar({
  label,
  available,
  monthly,
}: {
  label: string;
  available: number;
  monthly?: number | null;
}) {
  const pct =
    monthly && monthly > 0 ? Math.max(0, Math.min(100, Math.round((available / monthly) * 100))) : null;
  return (
    <div
      className="rounded-xl px-3 py-2 border space-y-1.5"
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between text-[0.74rem]">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
          {available.toLocaleString()}
          {monthly ? ` / ${monthly.toLocaleString()}` : ''}
        </span>
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: quotaColor(pct / 100),
            }}
          />
        </div>
      )}
    </div>
  );
}

function AccountQuotaCard({
  item,
  onOpenAccountSettings,
}: {
  item: AccountQuotaSnapshot;
  onOpenAccountSettings: () => void;
}) {
  const { t } = useI18n();
  const color = accountColor(item.accountId);
  const isExpired = item.errorCode === 'SESSION_EXPIRED';
  const hasError = Boolean(item.errorCode);

  return (
    <section
      className="rounded-2xl border p-4 space-y-3.5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: isExpired ? 'rgba(220, 38, 38, 0.4)' : 'var(--border-subtle)',
      }}
    >
      {/* Account Header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[0.86rem] font-bold text-white shrink-0"
            style={{ background: color }}
          >
            {(item.accountLabel || item.email || 'A').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[0.94rem] font-bold truncate">{item.accountLabel}</span>
              {(item.planName || item.userTier) && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-semibold"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  {item.planName || item.userTier}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[0.73rem] mt-0.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
              {item.email && <span className="truncate">{item.email}</span>}
              <span className="inline-flex items-center gap-1">
                <Laptop className="w-3 h-3" />
                {item.onlineDevices}/{item.totalDevices}
                {item.sourceDeviceName ? ` · ${item.sourceDeviceName}` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Health Status Pill */}
        {isExpired ? (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.7rem] font-semibold shrink-0"
            style={{ background: 'rgba(220, 38, 38, 0.12)', color: 'var(--red)' }}
          >
            <AlertTriangle className="w-3 h-3" />
            {t('accountExpiredShort')}
          </span>
        ) : !hasError ? (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.7rem] font-semibold shrink-0"
            style={{ background: 'rgba(22, 163, 74, 0.12)', color: 'var(--green)' }}
          >
            <CheckCircle2 className="w-3 h-3" />
            {t('accountHealthyShort')}
          </span>
        ) : null}
      </div>

      {/* Error / Re-auth Banner */}
      {hasError && (
        <div
          className="rounded-xl px-3 py-2.5 border text-[0.78rem] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          style={{
            background: isExpired ? 'rgba(220, 38, 38, 0.08)' : 'rgba(245, 158, 11, 0.1)',
            borderColor: isExpired ? 'rgba(220, 38, 38, 0.25)' : 'rgba(245, 158, 11, 0.28)',
            color: isExpired ? 'var(--red)' : 'var(--amber)',
          }}
        >
          <span className="leading-snug">
            {item.errorCode === 'NO_ONLINE_DEVICE'
              ? t('noOnlineDeviceQuota')
              : item.errorMessage || item.errorCode}
          </span>
          {isExpired && (
            <button
              type="button"
              onClick={onOpenAccountSettings}
              className="inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-lg text-[0.74rem] font-semibold shrink-0 cursor-pointer"
              style={{ background: 'var(--red)', color: '#fff' }}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t('reauthBtn')}</span>
            </button>
          )}
        </div>
      )}

      {/* Prompt / Flow Credits (if returned by GetUserStatus) */}
      {(typeof item.availablePromptCredits === 'number' || typeof item.availableFlowCredits === 'number') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {typeof item.availablePromptCredits === 'number' && (
            <CreditBar
              label={t('promptCreditsLabel')}
              available={item.availablePromptCredits}
              monthly={item.monthlyPromptCredits}
            />
          )}
          {typeof item.availableFlowCredits === 'number' && (
            <CreditBar
              label={t('flowCreditsLabel')}
              available={item.availableFlowCredits}
              monthly={item.monthlyFlowCredits}
            />
          )}
        </div>
      )}

      {/* Per-Model Quota Bars */}
      {item.models.length > 0 && (
        <div className="space-y-2">
          {item.models.map((m) => {
            const hasFrac = typeof m.remainingFraction === 'number';
            const frac = hasFrac ? Math.max(0, Math.min(1, m.remainingFraction!)) : 1;
            const pct = Math.round(frac * 100);
            const exhausted = hasFrac && frac <= 0.001;
            const resetStr = formatResetCountdown(m.resetTimeMs);
            return (
              <div
                key={m.id}
                className="rounded-xl px-3 py-2.5 border space-y-1.5"
                style={{
                  background: exhausted ? 'rgba(220, 38, 38, 0.05)' : 'var(--bg-elevated)',
                  borderColor: exhausted ? 'rgba(220, 38, 38, 0.25)' : 'var(--border-subtle)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: exhausted ? 'var(--red)' : 'var(--text-muted)' }} />
                    <span className="text-[0.82rem] font-semibold truncate">{m.displayName}</span>
                    {m.isDefault && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[0.62rem] font-semibold shrink-0"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}
                      >
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {resetStr && (
                      <span
                        className="inline-flex items-center gap-1 text-[0.7rem] font-mono"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Clock className="w-3 h-3" />
                        {t('quotaResetIn', { time: resetStr })}
                      </span>
                    )}
                    {hasFrac && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[0.7rem] font-mono font-bold"
                        style={{
                          background: exhausted
                            ? 'rgba(220, 38, 38, 0.14)'
                            : frac < 0.5
                              ? 'rgba(245, 158, 11, 0.14)'
                              : 'rgba(22, 163, 74, 0.12)',
                          color: quotaColor(frac),
                        }}
                      >
                        {exhausted ? t('quotaExhaustedBadge') : `${pct}%`}
                      </span>
                    )}
                  </div>
                </div>
                {hasFrac && (
                  <div
                    className="h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'var(--border-subtle)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(exhausted ? 0 : 2, pct)}%`,
                        background: quotaColor(frac),
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function QuotaDashboard({
  open,
  demoMode,
  accounts,
  onClose,
  onOpenAccountSettings,
}: QuotaDashboardProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [snapshot, setSnapshot] = useState<QuotaDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchQuota = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!isTauriRuntime() || demoMode) {
        setSnapshot(buildDemoQuotaSnapshot(accounts));
      } else {
        const res = await getAllAccountsQuota();
        setSnapshot(res);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [demoMode, accounts]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      void fetchQuota();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [open, fetchQuota]);

  const stats = useMemo(() => {
    const list = snapshot?.accounts || [];
    const total = list.length;
    const healthy = list.filter((a) => !a.errorCode || a.errorCode === 'NO_ONLINE_DEVICE').length;
    const onlineDevices = list.reduce((sum, a) => sum + a.onlineDevices, 0);
    const exhaustedModels = list.reduce(
      (sum, a) =>
        sum +
        a.models.filter((m) => typeof m.remainingFraction === 'number' && m.remainingFraction <= 0.001).length,
      0
    );
    return { total, healthy, onlineDevices, exhaustedModels };
  }, [snapshot]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="agy-sheet"
      style={{
        maxWidth: '860px',
        width: 'min(96vw, 860px)',
        maxHeight: '88dvh',
        borderRadius: '24px',
        margin: 'auto',
        padding: 0,
        background: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {open && (
        <div className="flex flex-col max-h-[88dvh]">
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 px-5 py-3.5 border-b shrink-0"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Gauge className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[1rem] font-bold leading-tight truncate">{t('quotaDashboard')}</h2>
                <p className="text-[0.74rem] truncate" style={{ color: 'var(--text-muted)' }}>
                  {t('quotaDashboardSub')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void fetchQuota()}
                disabled={loading}
                className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 cursor-pointer"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                aria-label="Refresh quota"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 cursor-pointer"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                aria-label="Close"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
            {/* Summary KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: t('totalAccountsKpi'), value: stats.total, color: 'var(--text-primary)' },
                { label: t('healthyAccountsKpi'), value: stats.healthy, color: 'var(--green)' },
                { label: t('onlineDevicesKpi'), value: stats.onlineDevices, color: 'var(--blue)' },
                {
                  label: t('exhaustedModelsKpi'),
                  value: stats.exhaustedModels,
                  color: stats.exhaustedModels > 0 ? 'var(--red)' : 'var(--text-muted)',
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-2xl border px-3.5 py-2.5"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                    {kpi.label}
                  </div>
                  <div className="text-[1.35rem] font-bold font-mono mt-0.5" style={{ color: kpi.color }}>
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div
                className="rounded-xl px-3.5 py-2.5 border text-[0.8rem]"
                style={{
                  background: 'rgba(220, 38, 38, 0.08)',
                  borderColor: 'rgba(220, 38, 38, 0.25)',
                  color: 'var(--red)',
                }}
              >
                {error}
              </div>
            )}

            {loading && !snapshot ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
                <span className="text-[0.82rem]">Loading live quotas across all accounts…</span>
              </div>
            ) : (snapshot?.accounts || []).length === 0 ? (
              <div className="py-12 text-center text-[0.85rem]" style={{ color: 'var(--text-muted)' }}>
                {t('addAccountsCta')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {(snapshot?.accounts || []).map((acc) => (
                  <AccountQuotaCard
                    key={acc.accountId}
                    item={acc}
                    onOpenAccountSettings={() => {
                      onClose();
                      onOpenAccountSettings();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
