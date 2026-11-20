import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { accountColor } from '../utils/colors';
import type { SyncStatusInfo } from '../api/tauriClient';
import type {
  AccountFetchError,
  AccountSummary,
  DeviceInstance,
  UnifiedSessionSummary,
} from '../types/agent';

interface SessionDrawerProps {
  open: boolean;
  variant?: 'drawer' | 'sidebar';
  accounts: AccountSummary[];
  accountErrors?: AccountFetchError[];
  syncStatus?: SyncStatusInfo;
  devices: DeviceInstance[];
  sessions: UnifiedSessionSummary[];
  activeSessionId: string;
  isLoading: boolean;
  onClose: () => void;
  onSelectSession: (session: UnifiedSessionSummary) => void;
  onNewSession: (accountId: string, deviceUuid: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function SessionDrawer({
  open,
  variant = 'drawer',
  accounts,
  accountErrors = [],
  syncStatus,
  devices,
  sessions,
  activeSessionId,
  isLoading,
  onClose,
  onSelectSession,
  onNewSession,
  onRefresh,
  onOpenSettings,
}: SessionDrawerProps) {
  const { t, formatRelativeTime } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedDevice, setSelectedDevice] = useState<string>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const subagentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (s.parentCascadeId) {
        counts.set(s.parentCascadeId, (counts.get(s.parentCascadeId) || 0) + 1);
      }
    }
    return counts;
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      // Never list subagent trajectories at top level; they belong inside their parent session
      if (s.parentCascadeId || (s.nestingDepth && s.nestingDepth > 0)) return false;
      if (selectedAccount !== 'all' && s.accountId !== selectedAccount) return false;
      if (selectedDevice !== 'all' && s.deviceUuid !== selectedDevice) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.workspaceName.toLowerCase().includes(q) ||
        s.deviceName.toLowerCase().includes(q) ||
        s.accountLabel.toLowerCase().includes(q)
      );
    });
  }, [sessions, query, selectedAccount, selectedDevice]);

  if (!open) return null;

  const authedCount = accounts.filter((a) => a.authenticated && a.enabled).length;
  const primaryAccount = accounts.find((a) => a.authenticated && a.enabled) || accounts[0];
  const targetDevice =
    devices.find((d) => d.uuid === selectedDevice) ||
    devices.find(
      (d) =>
        (selectedAccount === 'all' || d.accountId === selectedAccount) &&
        (d.status === 'RUNNING' || d.status === 'IDLE')
    ) ||
    devices[0];
  const filtersActive = selectedAccount !== 'all' || selectedDevice !== 'all';
  const selectedAccountLabel = accounts.find((acc) => acc.id === selectedAccount)?.label;
  const selectedDeviceLabel = devices.find((device) => device.uuid === selectedDevice)?.displayName;
  const clearFilters = () => {
    setSelectedAccount('all');
    setSelectedDevice('all');
  };

  const renderSessionRow = (s: UnifiedSessionSummary) => {
    const isActive = s.id === activeSessionId;
    const accCol = accountColor(s.accountId);
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => {
          onSelectSession(s);
          if (variant === 'drawer') onClose();
        }}
        className="w-full text-left px-3 py-2.5 rounded-xl active:scale-[0.99] transition-all cursor-pointer"
        style={{
          background: isActive ? 'var(--bg-elevated)' : 'transparent',
          border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[0.86rem] font-semibold line-clamp-1" style={{ color: 'var(--text-primary)' }}>
            {s.title}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {s.status === 'waiting_approval' && (
              <span
                className="px-1.5 py-0.5 rounded-full text-[0.65rem] font-semibold"
                style={{ background: 'rgba(245, 158, 11, 0.16)', color: 'var(--amber)' }}
              >
                {t('needsApproval')}
              </span>
            )}
            <span className="text-[0.7rem]" style={{ color: 'var(--text-muted)' }}>
              {formatRelativeTime(s.lastModifiedMs)}
            </span>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-1.5 mt-1 text-[0.72rem]" style={{ color: 'var(--text-secondary)' }}>
          {s.accountLabel && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[0.66rem] font-semibold"
              style={{ background: `${accCol}1f`, color: accCol }}
            >
              {s.accountLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-1 truncate max-w-[120px]">
            <Laptop className="w-3 h-3 shrink-0" />
            <span className="truncate">{s.deviceName}</span>
          </span>
          <span className="truncate max-w-[110px]" style={{ color: 'var(--text-muted)' }}>
            · {s.workspaceName}
          </span>
          {(subagentCounts.get(s.cascadeId) || 0) > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[0.64rem] font-medium shrink-0"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {subagentCounts.get(s.cascadeId)} sub
            </span>
          )}
        </div>
      </button>
    );
  };

  const panel = (
    <aside
      className={
        variant === 'sidebar'
          ? 'flex flex-col w-[280px] shrink-0 h-full border-r select-none'
          : 'agy-drawer-panel relative z-10 flex flex-col w-[86vw] max-w-[350px] h-full shadow-2xl border-r'
      }
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
        paddingTop: variant === 'sidebar' ? '0px' : 'env(safe-area-inset-top, 0px)',
        paddingBottom: variant === 'sidebar' ? '0px' : 'env(safe-area-inset-bottom, 0px)',
      }}
      onTouchStart={(e) => {
        if (variant === 'drawer') touchStartXRef.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (variant !== 'drawer' || touchStartXRef.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartXRef.current;
        touchStartXRef.current = null;
        if (dx < -64) onClose();
      }}
    >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <img src="/favicon.svg" alt="Antigravity" className="w-6.5 h-6.5 rounded-md shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[0.96rem] font-bold leading-tight truncate">{t('appName')}</div>
              <div className="text-[0.7rem] truncate" style={{ color: 'var(--text-muted)' }}>
                {authedCount > 0
                  ? t('accountsConnected', { accounts: authedCount, devices: devices.length })
                  : t('previewMultiAccount')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="p-3 space-y-2.5 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            disabled={!targetDevice}
            onClick={() => {
              if (targetDevice) {
                onNewSession(targetDevice.accountId, targetDevice.uuid);
                if (variant === 'drawer') onClose();
              }
            }}
            className="w-full flex items-center justify-center gap-2 h-11 px-3 rounded-xl font-semibold text-[0.86rem] active:scale-[0.98] transition-transform cursor-pointer disabled:opacity-45"
            style={{ background: 'var(--accent)', color: '#ffffff' }}
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {t('newSession')}
              {targetDevice ? ` · ${targetDevice.displayName}` : ''}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 px-3 h-10 rounded-xl border flex-1 min-w-0"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full bg-transparent text-[0.84rem] outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
            <button
              type="button"
              aria-label={t('filterSessions')}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((value) => !value)}
              className="relative flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 cursor-pointer"
              style={{
                background: filterOpen ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                borderColor: filterOpen ? 'var(--accent)' : 'var(--border-subtle)',
                color: filterOpen ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {filtersActive && (
                <span
                  className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          </div>

          {filtersActive && !filterOpen && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 max-w-full px-2.5 h-7 rounded-full text-[0.72rem] font-medium cursor-pointer"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <span className="truncate">
                {selectedAccountLabel || t('allAccounts')}
                {selectedDeviceLabel ? ` · ${selectedDeviceLabel}` : ''}
              </span>
              <X className="w-3 h-3 shrink-0" />
            </button>
          )}

          {filterOpen && (
            <div
              className="rounded-xl border p-2.5 space-y-2.5"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[0.72rem] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {t('filterSessions')}
                </span>
                {filtersActive && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-[0.7rem] font-medium cursor-pointer"
                    style={{ color: 'var(--accent)' }}
                  >
                    {t('clearFilters')}
                  </button>
                )}
              </div>

              {accounts.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-[0.68rem] font-medium" style={{ color: 'var(--text-muted)' }}>
                    {t('filterAccounts')}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedAccount('all')}
                      className="px-2.5 h-7 rounded-full text-[0.72rem] font-medium shrink-0 cursor-pointer"
                      style={{
                        background: selectedAccount === 'all' ? 'var(--text-primary)' : 'var(--bg-surface)',
                        color: selectedAccount === 'all' ? 'var(--bg-surface)' : 'var(--text-secondary)',
                      }}
                    >
                      {t('allAccounts')}
                    </button>
                    {accounts.map((acc) => {
                      const active = selectedAccount === acc.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setSelectedAccount(acc.id)}
                          className="flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[0.72rem] font-medium shrink-0 cursor-pointer"
                          style={{
                            background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                            color: active ? 'var(--bg-surface)' : 'var(--text-secondary)',
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: accountColor(acc.id) }}
                          />
                          <span>{acc.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {devices.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-[0.68rem] font-medium" style={{ color: 'var(--text-muted)' }}>
                    {t('filterDevices')}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedDevice('all')}
                      className="px-2.5 h-7 rounded-full text-[0.72rem] font-medium shrink-0 cursor-pointer"
                      style={{
                        background: selectedDevice === 'all' ? 'var(--text-primary)' : 'var(--bg-surface)',
                        color: selectedDevice === 'all' ? 'var(--bg-surface)' : 'var(--text-secondary)',
                      }}
                    >
                      {t('allDevices')}
                    </button>
                    {devices.map((d) => {
                      const active = selectedDevice === d.uuid;
                      return (
                        <button
                          key={`${d.accountId}-${d.uuid}`}
                          type="button"
                          onClick={() => setSelectedDevice(d.uuid)}
                          className="flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[0.72rem] font-medium shrink-0 cursor-pointer"
                          style={{
                            background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                            color: active ? 'var(--bg-surface)' : 'var(--text-secondary)',
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              background:
                                d.status === 'RUNNING'
                                  ? 'var(--green)'
                                  : d.status === 'IDLE'
                                    ? 'var(--amber)'
                                    : 'var(--text-muted)',
                            }}
                          />
                          <span>{d.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Session Feed */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {accountErrors.length > 0 && (() => {
            const expired = accountErrors.filter((e) => e.code === 'SESSION_EXPIRED');
            const isExp = expired.length > 0;
            const names = (isExp ? expired : accountErrors).map((e) => e.accountLabel).join(', ');
            return (
              <div
                className="mx-1 mb-2 rounded-xl p-2.5 border space-y-2"
                style={{
                  background: isExp ? 'rgba(220, 38, 38, 0.08)' : 'rgba(245, 158, 11, 0.1)',
                  borderColor: isExp ? 'rgba(220, 38, 38, 0.28)' : 'rgba(245, 158, 11, 0.3)',
                }}
              >
                <div className="flex items-start gap-2 text-[0.74rem] leading-snug" style={{ color: isExp ? 'var(--red)' : 'var(--amber)' }}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {isExp
                      ? t('sessionExpiredBanner', { accounts: names })
                      : t('networkErrorBanner', { accounts: names })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {isExp && (
                    <button
                      type="button"
                      onClick={() => {
                        if (variant === 'drawer') onClose();
                        onOpenSettings();
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 h-7.5 px-2 rounded-lg text-[0.72rem] font-semibold cursor-pointer"
                      style={{ background: 'var(--red)', color: '#fff' }}
                    >
                      <KeyRound className="w-3 h-3" />
                      <span className="truncate">{t('reauthBtn')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="inline-flex items-center justify-center gap-1 h-7.5 px-2.5 rounded-lg text-[0.72rem] font-semibold border cursor-pointer"
                    style={{
                      background: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>{t('retryBtn')}</span>
                  </button>
                </div>
              </div>
            );
          })()}

          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[0.82rem]" style={{ color: 'var(--text-muted)' }}>
              {t('noSessionsMatch')}
            </div>
          ) : (
            filtered.map(renderSessionRow)
          )}
        </div>

        {/* Claude-style Profile & Account Footer */}
        <button
          type="button"
          onClick={() => {
            if (variant === 'drawer') onClose();
            onOpenSettings();
          }}
          className="flex items-center justify-between gap-2.5 px-4 py-3 border-t shrink-0 text-left active:opacity-80 cursor-pointer"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {syncStatus?.signedIn && syncStatus.user?.avatarUrl ? (
              <img
                src={syncStatus.user.avatarUrl}
                alt={syncStatus.user.name || syncStatus.user.email}
                referrerPolicy="no-referrer"
                className="w-8.5 h-8.5 rounded-full object-cover shrink-0"
              />
            ) : (
              <div
                className="flex items-center justify-center w-8.5 h-8.5 rounded-full text-xs font-bold shrink-0"
                style={{
                  background: authedCount > 0 || syncStatus?.signedIn ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: authedCount > 0 || syncStatus?.signedIn ? '#fff' : 'var(--text-primary)',
                }}
              >
                {(syncStatus?.user?.name || syncStatus?.user?.email || primaryAccount?.label || 'A')
                  .slice(0, 1)
                  .toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[0.84rem] font-semibold truncate">
                {syncStatus?.signedIn && syncStatus.user
                  ? syncStatus.user.name || syncStatus.user.email
                  : authedCount > 0
                    ? t('accountsActive', { count: authedCount })
                    : accounts.length > 0
                      ? t('accountsSummary', {
                          name: primaryAccount?.label || 'Antigravity',
                          count: accounts.length,
                        })
                      : t('addAccountsCta')}
              </div>
              <div className="text-[0.7rem] truncate" style={{ color: 'var(--text-muted)' }}>
                {syncStatus?.signedIn && syncStatus.user?.email
                  ? syncStatus.user.email
                  : t('manageVaultSub')}
              </div>
            </div>
          </div>
          <span className="text-[0.76rem] font-semibold shrink-0" style={{ color: 'var(--accent)' }}>
            {t('manageAccounts')}
          </span>
        </button>
      </aside>
  );

  if (variant === 'sidebar') return panel;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      {panel}
    </div>
  );
}
