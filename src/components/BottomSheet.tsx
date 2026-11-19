import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  Palette,
  Plus,
  Shield,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useI18n, type LocaleCode } from '../i18n';
import { accountColor } from '../utils/colors';
import {
  checkAppUpdate,
  downloadAppUpdate,
  getTrajectorySteps,
  type SyncStatusInfo,
  type UpdateCheckResult,
} from '../api/tauriClient';
import { normalizeTrajectorySteps } from '../api/stepNormalizer';
import type {
  AccountSummary,
  DeviceInstance,
  ModelOption,
  PermissionMode,
  SheetDestination,
  ThemeMode,
  TimelineItem,
  UnifiedSessionSummary,
} from '../types/agent';
import { MarkdownView } from './MarkdownView';

export type FontSizeMode = 'compact' | 'default' | 'large';
type SettingsSubPage = 'overview' | 'accounts' | 'add-account' | 'sync-vault' | 'appearance' | 'updates';

interface BottomSheetProps {
  sheet: SheetDestination | null;
  accounts: AccountSummary[];
  syncStatus: SyncStatusInfo;
  theme: ThemeMode;
  fontSize: FontSizeMode;
  permissionMode: PermissionMode;
  activeModel: string;
  availableModels: ModelOption[];
  devices: DeviceInstance[];
  sessions: UnifiedSessionSummary[];
  onClose: () => void;
  onChangeTheme: (t: ThemeMode) => void;
  onChangeFontSize: (f: FontSizeMode) => void;
  onChangePermissionMode: (m: PermissionMode) => void;
  onChangeModel: (model: string) => void;
  onSelectSession: (s: UnifiedSessionSummary) => void;
  onApprove: (scope: 'once' | 'session') => void;
  onDeny: () => void;
  onOpenGoogleLogin: () => Promise<void>;
  onHarvestLoginCookies: (label: string) => Promise<void>;
  onImportAccountCookies: (label: string, raw: string) => Promise<void>;
  onToggleAccount: (accountId: string, enabled: boolean) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onExportVault: () => Promise<string>;
  onImportVault: (rawJson: string) => Promise<void>;
  onSyncSetServerUrl: (url: string) => Promise<void>;
  onSyncStartGoogleOAuth: () => Promise<void>;
  onSyncLoginGoogleIdToken: (idToken: string) => Promise<void>;
  onSyncLoginDevSso: (email: string) => Promise<void>;
  onSyncLogout: () => Promise<void>;
  onSyncPush: () => Promise<void>;
  onSyncPull: () => Promise<void>;
}

function DiffLines({ diff }: { diff: string }) {
  const lines = (diff || '').split('\n');
  return (
    <pre
      className="rounded-xl p-3 text-[0.76rem] font-mono overflow-x-auto leading-relaxed border"
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
    >
      {lines.map((line, i) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++');
        const isDel = line.startsWith('-') && !line.startsWith('---');
        const isHunk = line.startsWith('@@');
        return (
          <div
            key={i}
            className="px-1.5 -mx-1.5 rounded-sm whitespace-pre"
            style={{
              background: isAdd
                ? 'rgba(34, 197, 94, 0.14)'
                : isDel
                  ? 'rgba(239, 68, 68, 0.14)'
                  : 'transparent',
              color: isAdd
                ? 'var(--green)'
                : isDel
                  ? 'var(--red)'
                  : isHunk
                    ? 'var(--blue)'
                    : 'var(--text-primary)',
            }}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export function BottomSheet({
  sheet,
  accounts,
  syncStatus,
  theme,
  fontSize,
  permissionMode,
  activeModel,
  availableModels,
  devices,
  sessions,
  onClose,
  onChangeTheme,
  onChangeFontSize,
  onChangePermissionMode,
  onChangeModel,
  onSelectSession,
  onApprove,
  onDeny,
  onOpenGoogleLogin,
  onHarvestLoginCookies,
  onImportAccountCookies,
  onToggleAccount,
  onRemoveAccount,
  onExportVault,
  onImportVault,
  onSyncSetServerUrl,
  onSyncStartGoogleOAuth,
  onSyncLoginGoogleIdToken,
  onSyncLoginDevSso,
  onSyncLogout,
  onSyncPush,
  onSyncPull,
}: BottomSheetProps) {
  const { t, locale, setLocale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [subPage, setSubPage] = useState<SettingsSubPage>('overview');
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [cookieInput, setCookieInput] = useState('');
  const [vaultInput, setVaultInput] = useState('');
  const [syncServerInput, setSyncServerInput] = useState(syncStatus.serverUrl);
  const [ssoInput, setSsoInput] = useState('');
  const [updateRepo, setUpdateRepo] = useState(
    () => localStorage.getItem('agy.updateRepo') || 'HeiSir2014/antigravity-app'
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [artifactTab, setArtifactTab] = useState<'preview' | 'source'>('preview');
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [subagentItems, setSubagentItems] = useState<TimelineItem[]>([]);
  const [subagentLoading, setSubagentLoading] = useState(false);
  const [subagentError, setSubagentError] = useState('');

  useEffect(() => {
    setSyncServerInput(syncStatus.serverUrl);
  }, [syncStatus.serverUrl]);

  useEffect(() => {
    if (sheet?.kind !== 'SubagentView') return;
    let cancelled = false;
    setSubagentLoading(true);
    setSubagentError('');
    setSubagentItems([]);
    const sub = sheet.subagent;
    const offset = Math.max(0, (sub.stepCount || 0) - 80);
    void getTrajectorySteps(sub.accountId, sub.deviceUuid, sub.cascadeId, offset)
      .then((resp) => {
        if (cancelled) return;
        const norm = normalizeTrajectorySteps(resp.steps || [], sub.cascadeId);
        setSubagentItems(norm.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setSubagentError(String(err));
      })
      .finally(() => {
        if (!cancelled) setSubagentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sheet]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (sheet) {
      setSubPage('overview');
      setStatusMsg('');
      setDragOffsetY(0);
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [sheet]);

  if (!sheet) {
    return <dialog ref={dialogRef} className="agy-sheet" />;
  }

  const permissionOptions: Array<{ id: PermissionMode; title: string; desc: string }> = [
    { id: 'request-review', title: t('permAskTitle'), desc: t('permAskDesc') },
    { id: 'accept-edits', title: t('permEditTitle'), desc: t('permEditDesc') },
    { id: 'proceed-in-sandbox', title: t('permSandboxTitle'), desc: t('permSandboxDesc') },
    { id: 'always-proceed', title: t('permAutoTitle'), desc: t('permAutoDesc') },
  ];

  const getTitle = () => {
    if (sheet.kind === 'Settings') {
      if (subPage === 'accounts') return t('accountsRow');
      if (subPage === 'add-account') return t('addAccountTitle');
      if (subPage === 'sync-vault') return t('vaultTitle');
      if (subPage === 'appearance') return t('appearanceRow');
      if (subPage === 'updates') return t('appUpdatesRow');
      return t('sheetSettings');
    }
    switch (sheet.kind) {
      case 'ApprovalDiffDetail': return sheet.approval.toolName;
      case 'PermissionModeSelection': return t('sheetPermission');
      case 'PlanView': return sheet.title;
      case 'ImagePreview': return sheet.title;
      case 'DiffView': return sheet.title;
      case 'BackgroundShellOutput': return t('sheetTerminal');
      case 'CollapsedToolCalls': return sheet.title;
      case 'ViewThinking': return sheet.durationSec ? t('thoughtFor', { sec: sheet.durationSec }) : t('reasoning');
      case 'TaskList': return t('sheetTasks');
      case 'DeviceSessions': return t('sheetDevices');
      case 'ModelPicker': return t('sheetModel');
      case 'SubagentView': return sheet.subagent.subagentRole || sheet.subagent.title;
    }
  };

  const showBackBtn = sheet.kind === 'Settings' && subPage !== 'overview';
  const primaryAccount = accounts.find((a) => a.authenticated && a.enabled) || accounts[0];
  const authedCount = accounts.filter((a) => a.authenticated && a.enabled).length;

  return (
    <dialog
      ref={dialogRef}
      className="agy-sheet"
      style={{
        transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
        transition: dragStartYRef.current === null ? 'transform 0.2s ease' : 'none',
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex flex-col max-h-[90dvh]">
        {/* Interactive Touch Drag Handle */}
        <div
          className="flex justify-center pt-3 pb-1.5 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={(e) => {
            dragStartYRef.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            if (dragStartYRef.current === null) return;
            const delta = Math.max(0, e.touches[0].clientY - dragStartYRef.current);
            setDragOffsetY(delta);
          }}
          onTouchEnd={() => {
            const finalDelta = dragOffsetY;
            dragStartYRef.current = null;
            if (finalDelta > 72) {
              setDragOffsetY(0);
              onClose();
            } else {
              setDragOffsetY(0);
            }
          }}
        >
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
        </div>

        {/* Sheet Header */}
        <div
          className="flex items-center justify-between px-4 pb-3 pt-0.5 border-b shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {showBackBtn && (
              <button
                type="button"
                onClick={() => {
                  setStatusMsg('');
                  setSubPage(subPage === 'add-account' ? 'accounts' : 'overview');
                }}
                className="flex items-center justify-center w-8 h-8 -ml-1.5 rounded-full active:scale-95 cursor-pointer"
                style={{ color: 'var(--accent)' }}
                aria-label={t('back')}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className="text-[1rem] font-bold truncate">{getTitle()}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full active:scale-95 cursor-pointer shrink-0"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sheet Body */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {sheet.kind === 'SubagentView' && (
            <div className="space-y-3">
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl text-[0.75rem]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  {sheet.subagent.subagentType || 'subagent'} · {sheet.subagent.deviceName}
                </span>
                <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                  {sheet.subagent.cascadeId.slice(0, 8)} · {sheet.subagent.stepCount || 0} steps
                </span>
              </div>

              {subagentLoading && (
                <div className="py-10 flex items-center justify-center gap-2 text-[0.84rem]" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading subagent trajectory…</span>
                </div>
              )}

              {subagentError && (
                <div
                  className="rounded-xl p-3 text-[0.78rem] break-words"
                  style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}
                >
                  {subagentError}
                </div>
              )}

              {!subagentLoading && !subagentError && subagentItems.length === 0 && (
                <div className="py-8 text-center text-[0.82rem]" style={{ color: 'var(--text-muted)' }}>
                  No steps recorded yet for this subagent.
                </div>
              )}

              {subagentItems.map((item) => {
                if (item.kind === 'user') {
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl px-3.5 py-2.5 text-[0.82rem] leading-relaxed whitespace-pre-wrap"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                    >
                      {item.text}
                    </div>
                  );
                }
                if (item.kind === 'assistant') {
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl px-3.5 py-2.5 text-[0.82rem] leading-relaxed"
                      style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}
                    >
                      <MarkdownView markdown={item.markdown} />
                    </div>
                  );
                }
                if (item.kind === 'thinking') {
                  return (
                    <details
                      key={item.id}
                      className="rounded-xl px-3 py-2 text-[0.76rem]"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      <summary className="cursor-pointer font-medium">
                        {item.durationSec ? t('thoughtFor', { sec: item.durationSec }) : t('reasoning')}
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap leading-relaxed">{item.text}</div>
                    </details>
                  );
                }
                if (item.kind === 'tool') {
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl px-3 py-2 text-[0.75rem] font-mono flex items-center justify-between gap-2"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      <span className="truncate">{item.tool.name}: {item.tool.summary}</span>
                      <span className="shrink-0 text-[0.68rem]" style={{ color: 'var(--text-muted)' }}>
                        {item.tool.status}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}

          {sheet.kind === 'ApprovalDiffDetail' && (
            <>
              <div className="text-[0.88rem] font-semibold">{sheet.approval.title}</div>
              {sheet.approval.filePath && (
                <div className="text-[0.75rem] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {sheet.approval.filePath}
                </div>
              )}
              <DiffLines diff={sheet.approval.commandOrDiff} />
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onDeny();
                    onClose();
                  }}
                  className="flex-1 h-11 rounded-xl font-semibold text-[0.88rem] border active:scale-[0.98] cursor-pointer"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  {t('deny')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onApprove('once');
                    onClose();
                  }}
                  className="flex-1 h-11 rounded-xl font-semibold text-[0.88rem] active:scale-[0.98] cursor-pointer"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {t('allowOnce')}
                </button>
              </div>
            </>
          )}

          {sheet.kind === 'PermissionModeSelection' && (
            <div className="space-y-2">
              {permissionOptions.map((opt) => {
                const active = permissionMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChangePermissionMode(opt.id);
                      onClose();
                    }}
                    className="w-full flex items-start justify-between gap-3 p-3.5 rounded-2xl border text-left active:scale-[0.99] cursor-pointer"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                      borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                    }}
                  >
                    <div>
                      <div className="text-[0.88rem] font-semibold">{opt.title}</div>
                      <div className="text-[0.78rem] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {opt.desc}
                      </div>
                    </div>
                    {active && <Check className="w-4.5 h-4.5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />}
                  </button>
                );
              })}
            </div>
          )}

          {sheet.kind === 'ModelPicker' && (
            <div className="space-y-2">
              {availableModels.map((m) => {
                const active = m.displayName === activeModel || m.id === activeModel;
                const pct =
                  typeof m.remainingFraction === 'number'
                    ? Math.round(Math.max(0, Math.min(1, m.remainingFraction)) * 100)
                    : null;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onChangeModel(m.displayName);
                      onClose();
                    }}
                    className="w-full p-3.5 rounded-2xl border text-left active:scale-[0.99] cursor-pointer space-y-1.5"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                      borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.9rem] font-semibold">{m.displayName}</span>
                      <div className="flex items-center gap-2">
                        {pct !== null && (
                          <span className="text-[0.72rem] font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {t('quotaRemaining', { pct })}
                          </span>
                        )}
                        {active && <Check className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />}
                      </div>
                    </div>
                    {m.description && (
                      <div className="text-[0.76rem]" style={{ color: 'var(--text-secondary)' }}>
                        {m.description}
                      </div>
                    )}
                    {pct !== null && (
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: pct > 30 ? 'var(--green)' : pct > 10 ? 'var(--amber)' : 'var(--red)',
                          }}
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {sheet.kind === 'ImagePreview' && (
            <div className="flex flex-col items-center gap-3">
              <img
                src={sheet.src}
                alt={sheet.title}
                className="max-w-full max-h-[68dvh] rounded-2xl border object-contain"
                style={{ borderColor: 'var(--border-subtle)' }}
              />
            </div>
          )}

          {sheet.kind === 'PlanView' && (
            <>
              <div className="flex items-center justify-between gap-2">
                {sheet.path && (
                  <div className="text-[0.74rem] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    {sheet.path}
                  </div>
                )}
                <div className="flex items-center gap-1 p-0.5 rounded-lg shrink-0" style={{ background: 'var(--bg-elevated)' }}>
                  {(['preview', 'source'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setArtifactTab(tab)}
                      className="px-2.5 h-6.5 rounded-md text-[0.72rem] font-semibold cursor-pointer"
                      style={{
                        background: artifactTab === tab ? 'var(--bg-surface)' : 'transparent',
                        color: artifactTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {tab === 'preview' ? t('tabPreview') : t('tabSource')}
                    </button>
                  ))}
                </div>
              </div>
              {artifactTab === 'source' ? (
                <pre
                  className="p-3 rounded-xl font-mono text-[0.76rem] overflow-x-auto whitespace-pre-wrap border"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  {sheet.htmlPreview || sheet.markdown}
                </pre>
              ) : sheet.htmlPreview || sheet.title.endsWith('.html') || sheet.title.endsWith('.svg') ? (
                <iframe
                  title={sheet.title}
                  sandbox="allow-scripts"
                  srcDoc={sheet.htmlPreview || sheet.markdown}
                  className="w-full h-[60dvh] rounded-xl border bg-white"
                  style={{ borderColor: 'var(--border-subtle)' }}
                />
              ) : (
                <MarkdownView markdown={sheet.markdown} />
              )}
            </>
          )}

          {sheet.kind === 'DiffView' && (
            <>
              <div
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <span className="text-[0.78rem] font-mono font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {sheet.filePath || sheet.title}
                </span>
                <span className="text-[0.74rem] font-mono font-semibold shrink-0">
                  <span style={{ color: 'var(--green)' }}>
                    +{(sheet.diff.match(/^\+[^+]/gm) || []).length}
                  </span>{' '}
                  <span style={{ color: 'var(--red)' }}>
                    -{(sheet.diff.match(/^-[^-]/gm) || []).length}
                  </span>
                </span>
              </div>
              <DiffLines diff={sheet.diff} />
            </>
          )}

          {sheet.kind === 'BackgroundShellOutput' && (
            <>
              <div
                className="px-3 py-2 rounded-xl font-mono text-[0.8rem] border"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                $ {sheet.command}
              </div>
              <pre
                className="p-3 rounded-xl font-mono text-[0.76rem] overflow-x-auto whitespace-pre-wrap border"
                style={{ background: '#0d0f14', color: '#e5e7eb', borderColor: 'var(--border-subtle)' }}
              >
                {sheet.output || '(no output)'}
              </pre>
            </>
          )}

          {sheet.kind === 'CollapsedToolCalls' && (
            <div className="space-y-2.5">
              {sheet.tools.map((tool) => (
                <div
                  key={tool.id}
                  className="p-3.5 rounded-2xl border space-y-1"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.85rem] font-semibold">
                      {tool.name} · {tool.summary}
                    </span>
                    <span className="text-[0.7rem] uppercase font-mono" style={{ color: 'var(--text-muted)' }}>
                      {tool.status}
                    </span>
                  </div>
                  <div className="text-[0.76rem] font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--text-secondary)' }}>
                    {tool.detail}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sheet.kind === 'ViewThinking' && (
            <div className="text-[0.88rem] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
              {sheet.text}
            </div>
          )}

          {sheet.kind === 'TaskList' && (
            <div className="space-y-2">
              {sheet.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-2.5 p-3.5 rounded-2xl border"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  {task.status === 'done' ? (
                    <CheckCircle2 className="w-4.5 h-4.5 shrink-0 mt-0.5" style={{ color: 'var(--green)' }} />
                  ) : task.status === 'in_progress' ? (
                    <Loader2 className="w-4.5 h-4.5 shrink-0 mt-0.5 animate-spin" style={{ color: 'var(--accent)' }} />
                  ) : (
                    <Circle className="w-4.5 h-4.5 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                  )}
                  <span className="text-[0.86rem]">{task.label}</span>
                </div>
              ))}
            </div>
          )}

          {sheet.kind === 'DeviceSessions' && (
            <div className="space-y-3">
              <div className="text-[0.75rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('pairedMachines')} ({devices.length})
              </div>
              <div className="space-y-1.5">
                {devices.map((d) => (
                  <div
                    key={`${d.accountId}-${d.uuid}`}
                    className="flex items-center justify-between px-3.5 py-3 rounded-2xl border"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Laptop className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                      <div className="min-w-0">
                        <div className="text-[0.86rem] font-semibold truncate">{d.displayName}</div>
                        <div className="text-[0.73rem]" style={{ color: 'var(--text-muted)' }}>
                          {d.accountLabel} · {d.version} · {d.status}
                        </div>
                      </div>
                    </div>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        background:
                          d.status === 'RUNNING'
                            ? 'var(--green)'
                            : d.status === 'IDLE'
                              ? 'var(--amber)'
                              : 'var(--text-muted)',
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="text-[0.75rem] font-semibold uppercase tracking-wide pt-1" style={{ color: 'var(--text-muted)' }}>
                {t('recentSessions')} ({sessions.length})
              </div>
              <div className="space-y-1.5">
                {sessions.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onSelectSession(s);
                      onClose();
                    }}
                    className="w-full text-left px-3.5 py-3 rounded-2xl border active:scale-[0.99] cursor-pointer"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-[0.86rem] font-semibold truncate">{s.title}</div>
                    <div className="text-[0.73rem] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {s.accountLabel} · {s.deviceName} · {s.workspaceName}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 1:1 Claude Mobile Account & Settings Hub */}
          {sheet.kind === 'Settings' && subPage === 'overview' && (
            <div className="space-y-4">
              {/* Claude-style Profile Hero Card */}
              <div
                className="flex items-center gap-3.5 p-4 rounded-2xl border"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-full text-lg font-bold shrink-0"
                  style={{ background: 'var(--accent)', color: '#ffffff' }}
                >
                  {(primaryAccount?.label || 'A').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.98rem] font-bold truncate">
                      {primaryAccount?.label || 'Antigravity'}
                    </span>
                    <span
                      className="text-[0.68rem] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: authedCount > 0 ? 'rgba(34,197,94,0.16)' : 'var(--accent-soft)',
                        color: authedCount > 0 ? 'var(--green)' : 'var(--accent)',
                      }}
                    >
                      {authedCount > 0 ? t('liveBadge', { count: authedCount }) : t('previewBadge')}
                    </span>
                  </div>
                  <div className="text-[0.76rem] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {primaryAccount?.email || t('manageVaultSub')}
                  </div>
                </div>
              </div>

              {/* Grouped Settings List (Claude Mobile Style) */}
              <div
                className="rounded-2xl border overflow-hidden divide-y"
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSubPage('accounts')}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-75 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Users className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--accent)' }} />
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-semibold">{t('accountsRow')}</div>
                      <div className="text-[0.74rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {t('accountsRowDesc', { count: accounts.length })}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setSubPage('sync-vault')}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-75 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Cloud className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--blue)' }} />
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-semibold">{t('syncVaultRow')}</div>
                      <div className="text-[0.74rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {t('syncVaultRowDesc')}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setSubPage('appearance')}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-75 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Palette className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--green)' }} />
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-semibold">{t('appearanceRow')}</div>
                      <div className="text-[0.74rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {t('appearanceRowDesc')}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>

                <button
                  type="button"
                  onClick={() => setSubPage('updates')}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-75 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Download className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--blue)' }} />
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-semibold">{t('appUpdatesRow')}</div>
                      <div className="text-[0.74rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {t('appUpdatesRowDesc')}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>

                <div
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--amber)' }} />
                    <div className="text-[0.88rem] font-semibold">{t('permissionsRow')}</div>
                  </div>
                  <span className="text-[0.76rem] font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {permissionMode === 'request-review'
                      ? t('permAsk')
                      : permissionMode === 'accept-edits'
                        ? t('permAcceptEdits')
                        : permissionMode === 'proceed-in-sandbox'
                          ? t('permSandbox')
                          : t('permAuto')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Subpage: Multi-Account List */}
          {sheet.kind === 'Settings' && subPage === 'accounts' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {accounts.map((acc) => {
                  const col = accountColor(acc.id);
                  return (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between gap-2.5 p-3.5 rounded-2xl border"
                      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold shrink-0"
                          style={{ background: `${col}22`, color: col }}
                        >
                          {acc.label.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                            <span className="text-[0.88rem] font-semibold truncate">{acc.label}</span>
                          </div>
                          <div className="text-[0.72rem] truncate" style={{ color: 'var(--text-muted)' }}>
                            {acc.authenticated
                              ? `${acc.cookieCount} cookies · AuthUser ${acc.authUser}`
                              : acc.email || t('previewBadge')}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={acc.id.startsWith('demo-')}
                          onClick={() => void onToggleAccount(acc.id, !acc.enabled)}
                          className="px-2.5 h-8 rounded-xl text-[0.74rem] font-semibold border cursor-pointer disabled:cursor-default"
                          style={{
                            background: acc.enabled ? `${col}1c` : 'var(--bg-surface)',
                            borderColor: acc.enabled ? `${col}55` : 'var(--border-subtle)',
                            color: acc.enabled ? col : 'var(--text-muted)',
                          }}
                        >
                          {acc.enabled ? t('activeBadge') : t('pausedBadge')}
                        </button>
                        {!acc.id.startsWith('demo-') && (
                          <button
                            type="button"
                            onClick={() => void onRemoveAccount(acc.id)}
                            className="flex items-center justify-center w-8 h-8 rounded-xl cursor-pointer"
                            style={{ color: 'var(--red)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setSubPage('add-account')}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl font-semibold text-[0.88rem] active:scale-[0.98] cursor-pointer"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                <Plus className="w-4.5 h-4.5" />
                <span>{t('addAccountTitle')}</span>
              </button>
            </div>
          )}

          {/* Subpage: Add New Antigravity Account */}
          {sheet.kind === 'Settings' && subPage === 'add-account' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[0.8rem] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  <span>{t('accountLabelPlaceholder')}</span>
                </div>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t('accountLabelPlaceholder')}
                  className="w-full px-3.5 h-11 rounded-xl text-[0.86rem] border outline-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              {/* Priority 1: Direct Text or File Cookies Import */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[0.78rem] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t('cookieFallbackLabel')}
                  </label>
                  <label
                    className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[0.74rem] font-medium border cursor-pointer shrink-0"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>.txt / .json</span>
                    <input
                      type="file"
                      accept=".txt,.json,.cookies,text/plain,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const text = await file.text();
                        setCookieInput(text);
                        if (!newLabel.trim()) {
                          setNewLabel(file.name.replace(/\.(txt|json|cookies)$/i, ''));
                        }
                        setStatusMsg(`Loaded ${file.name} (${text.length} chars)`);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  rows={4}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="Cookie: SID=...; SAPISID=... / Copy as cURL / Cookie-Editor JSON / Netscape cookies.txt"
                  className="w-full p-3 rounded-xl text-[0.78rem] font-mono border outline-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !cookieInput.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setStatusMsg('');
                    try {
                      await onImportAccountCookies(
                        newLabel.trim() || `Account #${accounts.length + 1}`,
                        cookieInput
                      );
                      setNewLabel('');
                      setCookieInput('');
                      setSubPage('accounts');
                    } catch (e) {
                      setStatusMsg(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full h-11 rounded-xl text-[0.86rem] font-semibold active:scale-[0.98] cursor-pointer disabled:opacity-45"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {t('importCookiesBtn')}
                </button>
              </div>

              {/* Last Resort Fallback: Manual Website Login */}
              <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="text-[0.74rem]" style={{ color: 'var(--text-muted)' }}>
                  {t('signInGoogle')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setStatusMsg('');
                      try {
                        await onOpenGoogleLogin();
                        setStatusMsg('Login window opened — cookies will auto-capture once signed in.');
                      } catch (e) {
                        setStatusMsg(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex items-center justify-center gap-2 h-10 rounded-xl text-[0.8rem] font-medium border active:scale-[0.98] cursor-pointer"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t('signInGoogle')}</span>
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setStatusMsg('');
                      try {
                        await onHarvestLoginCookies(newLabel.trim() || `Account #${accounts.length + 1}`);
                        setNewLabel('');
                        setSubPage('accounts');
                      } catch (e) {
                        setStatusMsg(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex items-center justify-center gap-1.5 h-10 rounded-xl text-[0.8rem] font-medium border active:scale-[0.98] cursor-pointer"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('saveLoggedIn')}</span>
                  </button>
                </div>
              </div>

              {statusMsg && (
                <div className="text-[0.78rem]" style={{ color: 'var(--accent)' }}>
                  {statusMsg}
                </div>
              )}
            </div>
          )}

          {/* Subpage: Cloud Sync Server + Offline Vault */}
          {sheet.kind === 'Settings' && subPage === 'sync-vault' && (
            <div className="space-y-4">
              {/* Self-hosted / Default Cloud Server Card */}
              <div
                className="p-3.5 rounded-2xl border space-y-3"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cloud className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
                    <span className="text-[0.86rem] font-bold truncate">{t('cloudSyncTitle')}</span>
                  </div>
                  <span
                    className="text-[0.68rem] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: syncStatus.signedIn ? 'rgba(34,197,94,0.16)' : 'var(--bg-surface)',
                      color: syncStatus.signedIn ? 'var(--green)' : 'var(--text-muted)',
                    }}
                  >
                    {syncStatus.signedIn ? `v${syncStatus.vaultVersion}` : t('statusOffline')}
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="url"
                    value={syncServerInput}
                    onChange={(e) => setSyncServerInput(e.target.value)}
                    placeholder="https://antigravity.yterm.cn"
                    className="flex-1 px-3 h-9.5 rounded-xl text-[0.78rem] font-mono border outline-none min-w-0"
                    style={{
                      background: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onSyncSetServerUrl(syncServerInput);
                        setStatusMsg(t('saveBtn'));
                      } catch (e) {
                        setStatusMsg(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="px-3.5 h-9.5 rounded-xl text-[0.78rem] font-semibold border cursor-pointer shrink-0"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                  >
                    {t('saveBtn')}
                  </button>
                </div>

                {syncStatus.signedIn && syncStatus.user ? (
                  <div className="space-y-2.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[0.84rem] font-semibold truncate">{syncStatus.user.name}</div>
                        <div className="text-[0.72rem] truncate" style={{ color: 'var(--text-muted)' }}>
                          {syncStatus.user.email}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onSyncLogout()}
                        className="px-2.5 h-8 rounded-lg text-[0.74rem] font-semibold border cursor-pointer"
                        style={{ color: 'var(--red)', borderColor: 'var(--border-subtle)' }}
                      >
                        {t('logoutBtn')}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onSyncPush();
                            setStatusMsg('OK');
                          } catch (e) {
                            setStatusMsg(String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="h-10 rounded-xl text-[0.8rem] font-semibold cursor-pointer"
                        style={{ background: 'var(--accent)', color: '#fff' }}
                      >
                        {t('pushToCloud')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onSyncPull();
                            setStatusMsg('OK');
                          } catch (e) {
                            setStatusMsg(String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="h-10 rounded-xl text-[0.8rem] font-semibold border cursor-pointer"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                      >
                        {t('pullFromCloud')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onSyncStartGoogleOAuth();
                        } catch (e) {
                          setStatusMsg(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 h-11 rounded-xl text-[0.86rem] font-semibold active:scale-[0.98] cursor-pointer disabled:opacity-45"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>{t('continueGoogleSso')}</span>
                    </button>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ssoInput}
                        onChange={(e) => setSsoInput(e.target.value)}
                        placeholder={t('devSsoPlaceholder')}
                        className="flex-1 px-3 h-9.5 rounded-xl text-[0.76rem] border outline-none min-w-0"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-primary)',
                        }}
                      />
                      <button
                        type="button"
                        disabled={busy || !ssoInput.trim()}
                        onClick={async () => {
                          setBusy(true);
                          setStatusMsg('');
                          try {
                            const val = ssoInput.trim();
                            if (val.includes('.') && val.split('.').length === 3) {
                              await onSyncLoginGoogleIdToken(val);
                            } else {
                              await onSyncLoginDevSso(val);
                            }
                            setSsoInput('');
                          } catch (e) {
                            setStatusMsg(String(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="px-3.5 h-9.5 rounded-xl text-[0.78rem] font-semibold border cursor-pointer disabled:opacity-55 shrink-0"
                        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                      >
                        {t('loginBtn')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Offline Manual Vault Fallback */}
              <div className="space-y-2.5">
                <p className="text-[0.76rem] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {t('vaultDesc')}
                </p>

                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const json = await onExportVault();
                      await navigator.clipboard.writeText(json);
                      setStatusMsg(t('copied') + '!');
                    } catch (e) {
                      setStatusMsg(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-[0.84rem] font-semibold border active:scale-[0.98] cursor-pointer"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}
                >
                  <Copy className="w-4 h-4" />
                  <span>{t('copyVaultBtn')}</span>
                </button>

                <textarea
                  rows={3}
                  value={vaultInput}
                  onChange={(e) => setVaultInput(e.target.value)}
                  placeholder={t('vaultPlaceholder')}
                  className="w-full p-3 rounded-xl text-[0.76rem] font-mono border outline-none resize-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />

                <button
                  type="button"
                  disabled={busy || !vaultInput.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onImportVault(vaultInput);
                      setVaultInput('');
                      setStatusMsg('Synced!');
                    } catch (e) {
                      setStatusMsg(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-[0.84rem] font-semibold border active:scale-[0.98] cursor-pointer disabled:opacity-60"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)' }}
                >
                  <Download className="w-4 h-4" />
                  <span>{t('mergeVaultBtn')}</span>
                </button>
              </div>

              {statusMsg && (
                <div className="text-[0.8rem] font-medium" style={{ color: 'var(--accent)' }}>
                  {statusMsg}
                </div>
              )}
            </div>
          )}

          {/* Subpage: Appearance & Language (Global + CN + SG) */}
          {sheet.kind === 'Settings' && subPage === 'appearance' && (
            <div className="space-y-4">
              {/* Theme */}
              <div className="space-y-2">
                <div className="text-[0.76rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {t('themeLabel')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'system', label: t('themeSystem') },
                      { id: 'light', label: t('themeLight') },
                      { id: 'dark', label: t('themeDark') },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChangeTheme(item.id)}
                      className="h-10 rounded-xl text-[0.82rem] font-semibold border active:scale-[0.98] cursor-pointer"
                      style={{
                        background: theme === item.id ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        borderColor: theme === item.id ? 'var(--accent)' : 'var(--border-subtle)',
                        color: theme === item.id ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Size */}
              <div className="space-y-2">
                <div className="text-[0.76rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {t('fontSizeLabel')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'compact', label: t('fontCompact') },
                      { id: 'default', label: t('fontDefault') },
                      { id: 'large', label: t('fontLarge') },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChangeFontSize(item.id)}
                      className="h-10 rounded-xl text-[0.82rem] font-semibold border active:scale-[0.98] cursor-pointer"
                      style={{
                        background: fontSize === item.id ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        borderColor: fontSize === item.id ? 'var(--accent)' : 'var(--border-subtle)',
                        color: fontSize === item.id ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language (Global / China / Singapore) */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[0.76rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t('languageLabel')}</span>
                </div>
                <div className="space-y-1.5">
                  {(
                    [
                      { code: 'auto', label: t('langAuto') },
                      { code: 'en', label: 'English (Global / Singapore)' },
                      { code: 'zh-CN', label: '简体中文 (中国大陆 / 新加坡)' },
                      { code: 'zh-TW', label: '繁體中文' },
                    ] as Array<{ code: LocaleCode; label: string }>
                  ).map((item) => {
                    const active = locale === item.code;
                    return (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => setLocale(item.code)}
                        className="w-full flex items-center justify-between px-3.5 h-11 rounded-xl border text-[0.86rem] font-medium cursor-pointer"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                          borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                          color: active ? 'var(--accent)' : 'var(--text-primary)',
                        }}
                      >
                        <span>{item.label}</span>
                        {active && <Check className="w-4 h-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Subpage: GitHub Releases Auto-Update (Incremental + Full APK) */}
          {sheet.kind === 'Settings' && subPage === 'updates' && (
            <div className="space-y-3.5">
              <div
                className="p-3.5 rounded-2xl border space-y-2.5"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[0.86rem] font-bold">GitHub Repository</span>
                  <span className="text-[0.72rem] font-mono" style={{ color: 'var(--text-muted)' }}>
                    v2.0.0
                  </span>
                </div>
                <input
                  type="text"
                  value={updateRepo}
                  onChange={(e) => {
                    setUpdateRepo(e.target.value);
                    localStorage.setItem('agy.updateRepo', e.target.value);
                  }}
                  placeholder="owner/repo"
                  className="w-full px-3 h-9.5 rounded-xl text-[0.8rem] font-mono border outline-none"
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setStatusMsg('');
                    setDownloadPercent(null);
                    try {
                      const res = await checkAppUpdate(updateRepo);
                      setUpdateInfo(res);
                      setStatusMsg(
                        res.hasUpdate
                          ? `Update v${res.latestVersion} available (${res.strategy})`
                          : `You are on the latest version (v${res.currentVersion})`
                      );
                    } catch (e) {
                      setStatusMsg(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full h-10 rounded-xl text-[0.84rem] font-semibold cursor-pointer disabled:opacity-45"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Check for Updates
                </button>
              </div>

              {updateInfo && updateInfo.hasUpdate && updateInfo.targetAsset && (
                <div
                  className="p-3.5 rounded-2xl border space-y-2.5"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--accent)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.88rem] font-bold">v{updateInfo.latestVersion}</span>
                    <span
                      className="text-[0.7rem] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background:
                          updateInfo.strategy === 'incremental'
                            ? 'rgba(34,197,94,0.16)'
                            : 'var(--accent-soft)',
                        color: updateInfo.strategy === 'incremental' ? 'var(--green)' : 'var(--accent)',
                      }}
                    >
                      {updateInfo.strategy === 'incremental' ? 'Incremental Delta (~120 KB)' : 'Full Native APK'}
                    </span>
                  </div>
                  <div className="text-[0.76rem] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {updateInfo.targetAsset.name} ({Math.max(1, Math.round(updateInfo.targetAsset.size / 1024))} KB)
                  </div>
                  {downloadPercent !== null && (
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
                      <div
                        className="h-full transition-all"
                        style={{ width: `${downloadPercent}%`, background: 'var(--accent)' }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!updateInfo.targetAsset) return;
                      setBusy(true);
                      setDownloadPercent(0);
                      try {
                        await downloadAppUpdate(updateInfo.targetAsset, updateInfo.strategy, (evt) => {
                          if (evt.kind === 'progress') setDownloadPercent(evt.percent);
                          if (evt.kind === 'verifying') setStatusMsg('Verifying SHA-256 signature…');
                          if (evt.kind === 'ready') {
                            setDownloadPercent(100);
                            setStatusMsg(`Verified & ready: ${evt.filePath}`);
                          }
                          if (evt.kind === 'error') setStatusMsg(evt.message);
                        });
                      } catch (e) {
                        setStatusMsg(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full h-10 rounded-xl text-[0.84rem] font-semibold border cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                  >
                    Download &amp; Verify SHA-256
                  </button>
                </div>
              )}

              {statusMsg && (
                <div className="text-[0.78rem]" style={{ color: 'var(--text-secondary)' }}>
                  {statusMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
