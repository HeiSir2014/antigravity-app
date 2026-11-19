import { Check, ChevronRight, ShieldAlert, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { PendingApproval } from '../types/agent';

interface ApprovalBannerProps {
  approval: PendingApproval;
  isSubmitting: boolean;
  onInspect: () => void;
  onApprove: (scope: 'once' | 'session') => void;
  onDeny: () => void;
}

export function ApprovalBanner({
  approval,
  isSubmitting,
  onInspect,
  onApprove,
  onDeny,
}: ApprovalBannerProps) {
  const { t } = useI18n();
  return (
    <div className="px-3 md:px-6 mb-2 shrink-0">
    <div
      className="max-w-3xl mx-auto w-full rounded-2xl border shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'rgba(245, 158, 11, 0.45)',
      }}
    >
      <button
        type="button"
        onClick={onInspect}
        className="w-full flex items-start justify-between gap-2 px-3.5 pt-3 pb-2 text-left active:opacity-80 cursor-pointer"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 mt-0.5"
            style={{ background: 'rgba(245, 158, 11, 0.16)', color: 'var(--amber)' }}
          >
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[0.85rem] font-semibold leading-tight">
              {approval.kind === 'runCommand' ? t('allowCommandTitle') : approval.title}
            </div>
            <div
              className="mt-1.5 px-2.5 pr-6 py-1 rounded-lg text-[0.75rem] font-mono overflow-x-auto whitespace-nowrap no-scrollbar scroll-fade-right"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
              }}
            >
              {approval.commandOrDiff}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 mt-1" style={{ color: 'var(--text-muted)' }} />
      </button>

      <div className="flex items-center gap-2 px-3.5 pb-3 pt-1">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onDeny}
          className="flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl text-[0.82rem] font-semibold border active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          <X className="w-3.5 h-3.5" />
          <span>{t('deny')}</span>
        </button>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => onApprove('once')}
          className="flex-1 flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl text-[0.82rem] font-semibold active:scale-95 transition-transform cursor-pointer disabled:opacity-50"
          style={{
            background: 'var(--accent)',
            color: '#ffffff',
          }}
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t('allowOnce')}</span>
        </button>
      </div>
    </div>
    </div>
  );
}
