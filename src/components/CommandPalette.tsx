import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Laptop, Plus, Search, Settings, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { AccountSummary, DeviceInstance, UnifiedSessionSummary } from '../types/agent';

interface CommandPaletteProps {
  open: boolean;
  sessions: UnifiedSessionSummary[];
  devices: DeviceInstance[];
  accounts: AccountSummary[];
  onClose: () => void;
  onSelectSession: (session: UnifiedSessionSummary) => void;
  onNewSession: (accountId: string, deviceUuid: string) => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
}

export function CommandPalette({
  open,
  sessions,
  devices,
  accounts,
  onClose,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onOpenUsage,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions
      .filter((session) => !session.parentCascadeId && !(session.nestingDepth && session.nestingDepth > 0))
      .filter((session) => {
        if (!needle) return true;
        return [session.title, session.accountLabel, session.deviceName, session.workspaceName]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, 8);
  }, [query, sessions]);

  if (!open) return null;

  const targetDevice =
    devices.find((device) => device.status === 'RUNNING') ||
    devices.find((device) => device.status === 'IDLE') ||
    devices[0];
  const primaryAccount = accounts.find((account) => account.authenticated && account.enabled);

  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label={t('commandPaletteClose')}
        onClick={onClose}
        className="fixed inset-0 bg-black/45 backdrop-blur-[2px] cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette')}
        className="relative w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
      >
        <div
          className="flex items-center gap-2.5 px-3.5 h-12 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('commandPalettePlaceholder')}
            className="flex-1 min-w-0 bg-transparent outline-none text-[0.9rem]"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('commandPaletteClose')}
            className="flex items-center justify-center w-7 h-7 rounded-lg cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[56vh] overflow-y-auto overscroll-contain p-2">
          {!query.trim() && (
            <div className="space-y-0.5">
              <div className="px-2 py-1.5 text-[0.68rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('commandActions')}
              </div>
              <button
                type="button"
                disabled={!targetDevice}
                onClick={() =>
                  targetDevice &&
                  run(() => onNewSession(targetDevice.accountId, targetDevice.uuid))
                }
                className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left active:opacity-75 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-[0.84rem] font-medium">{t('newSession')}</span>
                {targetDevice && (
                  <span className="ml-auto text-[0.7rem] truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>
                    {targetDevice.displayName}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => run(onOpenUsage)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left active:opacity-75 cursor-pointer"
              >
                <Gauge className="w-4 h-4 shrink-0" style={{ color: 'var(--green)' }} />
                <span className="text-[0.84rem] font-medium">{t('quotaDashboard')}</span>
              </button>
              <button
                type="button"
                onClick={() => run(onOpenSettings)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left active:opacity-75 cursor-pointer"
              >
                <Settings className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                <span className="text-[0.84rem] font-medium">{t('sheetSettings')}</span>
                {primaryAccount && (
                  <span className="ml-auto text-[0.7rem] truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>
                    {primaryAccount.label}
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="px-2 py-1.5 mt-1 text-[0.68rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            {query.trim() ? t('commandResults') : t('commandSessions')}
          </div>
          {filteredSessions.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-[0.8rem]" style={{ color: 'var(--text-muted)' }}>
              {t('noSessionsMatch')}
            </div>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => run(() => onSelectSession(session))}
                className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left active:opacity-75 cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.84rem] font-medium truncate">{session.title}</span>
                  <span className="block text-[0.7rem] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {session.accountLabel} · {session.deviceName} · {session.workspaceName}
                  </span>
                </span>
                <Laptop className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              </button>
            ))
          )}
        </div>

        <div
          className="flex items-center justify-between px-3.5 py-2 border-t text-[0.68rem]"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          <span>{t('commandPaletteHint')}</span>
          <span className="font-mono">esc</span>
        </div>
      </div>
    </div>
  );
}
