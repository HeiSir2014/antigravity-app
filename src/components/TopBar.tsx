import { FileDiff, Gauge, ListChecks, Menu, Settings } from 'lucide-react';
import { useI18n } from '../i18n';
import type { UnifiedSessionSummary } from '../types/agent';

interface TopBarProps {
  session: UnifiedSessionSummary | null;
  hasPendingApproval: boolean;
  totalAdditions: number;
  totalDeletions: number;
  taskCount: number;
  isLiveConnected: boolean;
  onOpenDrawer: () => void;
  onOpenDevices: () => void;
  onOpenDiff: () => void;
  onOpenTasks: () => void;
  onOpenQuotaDashboard: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  session,
  hasPendingApproval,
  totalAdditions,
  totalDeletions,
  taskCount,
  isLiveConnected,
  onOpenDrawer,
  onOpenDevices,
  onOpenDiff,
  onOpenTasks,
  onOpenQuotaDashboard,
  onOpenSettings,
}: TopBarProps) {
  const { t } = useI18n();
  return (
    <header
      className="shrink-0 border-b select-none w-full"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'var(--bg-canvas)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 h-[52px] w-full min-w-0">
      {/* Left: Drawer trigger with approval dot */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open sessions drawer"
        className="relative flex items-center justify-center w-10 h-10 shrink-0 rounded-xl active:scale-95 transition-transform cursor-pointer"
        style={{ color: 'var(--text-primary)' }}
      >
        <Menu className="w-5 h-5" />
        {hasPendingApproval && (
          <span
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full"
            style={{
              background: 'var(--amber)',
              boxShadow: '0 0 0 2px var(--bg-canvas)',
            }}
          />
        )}
      </button>

      {/* Center: Session title + machine status pill */}
      <button
        type="button"
        onClick={onOpenDevices}
        className="flex flex-col items-center justify-center min-w-0 flex-1 px-1.5 pr-2 py-1 rounded-xl active:opacity-75 transition-opacity cursor-pointer overflow-hidden"
      >
        <div
          className="text-[0.88rem] font-semibold truncate w-full text-center leading-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          {session?.title || 'Antigravity'}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-[0.71rem] leading-tight mt-0.5 w-full min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: isLiveConnected
                ? 'var(--green)'
                : session?.deviceStatus === 'RUNNING'
                  ? 'var(--green)'
                  : session?.deviceStatus === 'IDLE'
                    ? 'var(--amber)'
                    : 'var(--text-muted)',
            }}
          />
          <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
            {session ? `${session.accountLabel} · ${session.deviceName}` : t('demoPreview')}
          </span>
        </div>
      </button>

      {/* Right: Diff pill + Tasks + Settings */}
      <div className="flex items-center gap-1 shrink-0">
        {(totalAdditions > 0 || totalDeletions > 0) && (
          <button
            type="button"
            onClick={onOpenDiff}
            className="flex items-center gap-1 h-8 px-2 rounded-lg text-[0.74rem] font-mono font-semibold active:scale-95 transition-transform cursor-pointer"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
            }}
            title="View workspace changes"
          >
            <FileDiff className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
            <span style={{ color: 'var(--green)' }}>+{totalAdditions}</span>
            <span style={{ color: 'var(--red)' }}>-{totalDeletions}</span>
          </button>
        )}

        {taskCount > 0 && (
          <button
            type="button"
            onClick={onOpenTasks}
            aria-label="Tasks"
            className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 transition-transform cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ListChecks className="w-4.5 h-4.5" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpenQuotaDashboard}
          aria-label={t('quotaDashboard')}
          title={t('quotaDashboard')}
          className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 transition-transform cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Gauge className="w-4.5 h-4.5" />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="flex items-center justify-center w-9 h-9 rounded-xl active:scale-95 transition-transform cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
      </div>
      </div>
    </header>
  );
}
