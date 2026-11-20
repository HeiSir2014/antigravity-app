import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, Cloud, FileUp, Gauge, Globe, KeyRound, RefreshCw, Sparkles } from 'lucide-react';
import {
  cancelInvocation,
  exportVaultJson,
  getModelConfigs,
  getSlashCommands,
  getTrajectorySteps,
  getWorkspaceInfos,
  handleUserInteraction,
  harvestLoginCookies,
  importAccountCookies,
  importVaultJson,
  isTauriRuntime,
  listAccounts,
  listAllSessions,
  openGoogleLogin,
  removeAccount,
  sendUserMessage,
  startCascade,
  stopAgentStream,
  streamAgentState,
  syncCompleteOAuthCallback,
  syncGetStatus,
  syncLoginDevSso,
  syncLoginGoogleIdToken,
  syncLogout,
  syncPullVault,
  syncPushVault,
  syncSetServerUrl,
  syncStartGoogleOAuth,
  toggleAccount,
  type SyncStatusInfo,
} from './api/tauriClient';
import { buildInteractionPayload } from './api/interactionPayload';
import { mapClientModelConfigs } from './api/modelConfig';
import { mapSlashCommands } from './api/slashCommands';
import { isQuotaLimitError, normalizeTrajectorySteps } from './api/stepNormalizer';
import { AgentTimeline } from './components/AgentTimeline';
import { ApprovalBanner } from './components/ApprovalBanner';
import { BottomSheet, type FontSizeMode } from './components/BottomSheet';
import { CommandPalette } from './components/CommandPalette';
import { Composer } from './components/Composer';
import { formatResetCountdown } from './components/UsagePanel';
import { SessionDrawer } from './components/SessionDrawer';
import { TopBar } from './components/TopBar';
import { createTranslator, I18nContext, resolveLocale, type LocaleCode } from './i18n';
import {
  DEMO_ACCOUNTS,
  DEMO_APPROVAL,
  DEMO_DEVICES,
  DEMO_SESSIONS,
  DEMO_TASKS,
  DEMO_TIMELINE,
} from './data/demoSession';
import type {
  AccountFetchError,
  AccountSummary,
  DeviceInstance,
  MediaAttachment,
  ModelOption,
  PendingApproval,
  PermissionMode,
  SheetDestination,
  TaskChecklistItem,
  ThemeMode,
  TimelineItem,
  UnifiedSessionSummary,
} from './types/agent';

const DEFAULT_MODELS: ModelOption[] = [
  { id: 'gemini-4-neon', displayName: 'Gemini 4 Neon', description: '快速均衡 · 日常推理与编码', remainingFraction: 0.88, isDefault: true },
  { id: 'gemini-4-argon', displayName: 'Gemini 4 Argon', description: '深度架构与复杂排障', remainingFraction: 0.72 },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', description: '高效日常软件工程', remainingFraction: 0.94 },
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', description: '极致推理深度与规划', remainingFraction: 0.61 },
];

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('agy.theme') as ThemeMode | null;
    return saved || 'system';
  });
  const [fontSize, setFontSize] = useState<FontSizeMode>(() => {
    const saved = localStorage.getItem('agy.fontSize') as FontSizeMode | null;
    return saved || 'default';
  });
  const [locale, setLocale] = useState<LocaleCode>(() => {
    const saved = localStorage.getItem('agy.locale') as LocaleCode | null;
    return saved || 'auto';
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const saved = localStorage.getItem('agy.permissionMode') as PermissionMode | null;
    return saved || 'request-review';
  });
  const [activeModel, setActiveModel] = useState(DEFAULT_MODELS[0].displayName);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(DEFAULT_MODELS);
  const [remoteSlashCommands, setRemoteSlashCommands] = useState<
    Array<{ cmd: string; desc: string }>
  >([]);
  const edgeTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const i18nValue = useMemo(() => {
    const resolved = resolveLocale(locale);
    return {
      locale,
      resolved,
      setLocale: (next: LocaleCode) => {
        setLocale(next);
        localStorage.setItem('agy.locale', next);
      },
      ...createTranslator(resolved),
    };
  }, [locale]);

  const inTauri = isTauriRuntime();
  const [demoMode, setDemoMode] = useState(!inTauri);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingMsg, setOnboardingMsg] = useState('');
  const [onboardingCookieText, setOnboardingCookieText] = useState('');
  const [onboardingLabel, setOnboardingLabel] = useState('');
  const cookieFileInputRef = useRef<HTMLInputElement | null>(null);

  const [accounts, setAccounts] = useState<AccountSummary[]>(() => (inTauri ? [] : DEMO_ACCOUNTS));
  const [accountErrors, setAccountErrors] = useState<AccountFetchError[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>({
    serverUrl: 'https://antigravity.yterm.cn',
    signedIn: false,
    user: null,
    vaultVersion: 0,
    lastSyncedMs: 0,
  });
  const [devices, setDevices] = useState<DeviceInstance[]>(() => (inTauri ? [] : DEMO_DEVICES));
  const [sessions, setSessions] = useState<UnifiedSessionSummary[]>(() => (inTauri ? [] : DEMO_SESSIONS));
  const [activeSession, setActiveSession] = useState<UnifiedSessionSummary | null>(() =>
    inTauri ? null : DEMO_SESSIONS[0]
  );

  const [timeline, setTimeline] = useState<TimelineItem[]>(() => (inTauri ? [] : DEMO_TIMELINE));
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(() =>
    inTauri ? null : DEMO_APPROVAL
  );
  const [tasks, setTasks] = useState<TaskChecklistItem[]>(() => (inTauri ? [] : DEMO_TASKS));
  const [allDiffs, setAllDiffs] = useState<
    Array<{ title: string; filePath: string; diff: string; additions: number; deletions: number }>
  >([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetDestination | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const pendingApprovalKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const hasLiveAccount = useMemo(
    () => accounts.some((a) => !a.id.startsWith('demo-') && a.authenticated && a.enabled),
    [accounts]
  );

  const activeSubagents = useMemo(
    () =>
      activeSession
        ? sessions.filter((s) => s.parentCascadeId === activeSession.cascadeId)
        : [],
    [sessions, activeSession]
  );

  const activeModelOption = useMemo(
    () => availableModels.find((m) => m.displayName === activeModel || m.id === activeModel) || null,
    [availableModels, activeModel]
  );

  useEffect(() => {
    localStorage.setItem('agy.theme', theme);
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('agy.fontSize', fontSize);
    document.documentElement.setAttribute('data-font', fontSize);
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('agy.permissionMode', permissionMode);
  }, [permissionMode]);

  const loadSessionTrajectory = useCallback(async (session: UnifiedSessionSummary) => {
    setActiveSession(session);
    setRemoteSlashCommands([]);
    if (!isTauriRuntime() || session.accountId.startsWith('demo-')) {
      setTimeline(DEMO_TIMELINE);
      setPendingApproval(DEMO_APPROVAL);
      setTasks(DEMO_TASKS);
      return;
    }

    if (activeStreamIdRef.current) {
      void stopAgentStream(activeStreamIdRef.current).catch(() => {});
      activeStreamIdRef.current = null;
    }
    setIsLiveConnected(false);

    // Show cached steps immediately if available so flaky mobile/tunnel reconnects never show a blank screen
    const cacheKey = `agy.steps.${session.cascadeId}`;
    let hadCachedSteps = false;
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cachedSteps = JSON.parse(cachedRaw) as unknown[];
        if (Array.isArray(cachedSteps) && cachedSteps.length > 0) {
          const norm = normalizeTrajectorySteps(cachedSteps, session.cascadeId);
          setTimeline(norm.items);
          setPendingApproval(norm.pendingApproval);
          setAllDiffs(norm.allDiffs);
          setTasks(norm.tasks);
          hadCachedSteps = true;
        }
      }
    } catch {
      // Ignore corrupt cache
    }

    const initialOffset = Math.max(0, (session.stepCount || 0) - 100);
    try {
      const resp = await getTrajectorySteps(
        session.accountId,
        session.deviceUuid,
        session.cascadeId,
        initialOffset
      );
      const rawSteps = resp.steps || [];
      try {
        if (rawSteps.length > 0) {
          localStorage.setItem(cacheKey, JSON.stringify(rawSteps.slice(-100)));
        }
      } catch {
        // Ignore quota errors
      }
      const normalized = normalizeTrajectorySteps(rawSteps, session.cascadeId);
      setTimeline(normalized.items);
      setPendingApproval(normalized.pendingApproval);
      setAllDiffs(normalized.allDiffs);
      setTasks(normalized.tasks);
      setIsRunning(normalized.isRunning);

      // Fetch real model configs & quota from the remote machine in background
      void getModelConfigs(session.accountId, session.deviceUuid)
        .then((raw) => {
          const mapped = mapClientModelConfigs(raw);
          if (mapped.length > 0) {
            setAvailableModels(mapped);
            setActiveModel((prev) => {
              const existing = mapped.find((m) => m.displayName === prev || m.id === prev);
              if (existing) return existing.displayName;
              return (mapped.find((m) => m.isDefault) || mapped[0]).displayName;
            });
          }
        })
        .catch(() => {});

      // Prefer the workspace/agent's own slash commands over the built-in
      // Claude-style fallback list.
      // Let the backend resolve the default model from GetAvailableModels;
      // `loadSessionTrajectory` has stable deps and must not capture the
      // current UI model here.
      void getSlashCommands(session.accountId, session.deviceUuid, session.cascadeId)
        .then((raw) => setRemoteSlashCommands(mapSlashCommands(raw)))
        .catch(() => {});
    } catch (err) {
      const errStr = String(err);
      if (!hadCachedSteps) {
        setTimeline([
          {
            id: 'load-err',
            kind: 'error',
            stepIndex: 0,
            message: errStr.includes('TUNNEL_UNAVAILABLE')
              ? i18nValue.resolved === 'en'
                ? 'Workstation remote tunnel is temporarily offline or reconnecting. Tap refresh or wait a few seconds…'
                : '工作站远程隧道暂时断开或正在重连，请确认电脑端 Antigravity 在线并稍候自动重连…'
              : `Failed to load session steps: ${errStr}`,
          },
        ]);
      }
    }

    const streamId = `stream-${Date.now()}`;
    activeStreamIdRef.current = streamId;
    void streamAgentState(streamId, session.accountId, session.deviceUuid, session.cascadeId, (evt) => {
      if (evt.kind === 'connected') {
        setIsLiveConnected(true);
      } else if (evt.kind === 'update') {
        const payload = evt.payload as { stepCount?: number } | undefined;
        const nextOffset = Math.max(0, (payload?.stepCount || session.stepCount || 0) - 100);
        void getTrajectorySteps(session.accountId, session.deviceUuid, session.cascadeId, nextOffset)
          .then((r) => {
            const norm = normalizeTrajectorySteps(r.steps || [], session.cascadeId);
            setTimeline(norm.items);
            setPendingApproval(norm.pendingApproval);
            setAllDiffs(norm.allDiffs);
            setTasks(norm.tasks);
            setIsRunning(norm.isRunning);
          })
          .catch(() => {});
      } else if (evt.kind === 'error') {
        setIsLiveConnected(false);
        if (evt.message.includes('SESSION_EXPIRED')) {
          setAccountErrors((prev) => {
            if (prev.some((e) => e.accountId === session.accountId && e.code === 'SESSION_EXPIRED')) {
              return prev;
            }
            return [
              ...prev,
              {
                accountId: session.accountId,
                accountLabel: session.accountLabel,
                code: 'SESSION_EXPIRED',
                message: evt.message,
              },
            ];
          });
        }
      } else if (evt.kind === 'closed') {
        setIsLiveConnected(false);
      }
    }).catch(() => {
      setIsLiveConnected(false);
    });
  }, []);

  const refreshLiveSessions = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsLoadingSessions(true);
    try {
      const accs = await listAccounts();
      if (accs.length > 0) {
        setDemoMode(false);
        setAccounts(accs);
      } else {
        setAccounts([]);
        setDevices([]);
        setSessions([]);
        setActiveSession(null);
        setTimeline([]);
        setPendingApproval(null);
        setTasks([]);
        return;
      }

      const snapshot = await listAllSessions();
      const errs = snapshot.accountErrors || [];
      setAccounts(snapshot.accounts);
      setAccountErrors(errs);

      // High-availability guard: on transient network errors with 0 returned devices, preserve last-known list
      const onlyNetworkErrors =
        errs.length > 0 && errs.every((e) => e.code === 'NETWORK_ERROR');
      if (snapshot.devices.length > 0 || !onlyNetworkErrors) {
        setDevices(snapshot.devices);
        setSessions(snapshot.sessions);
        const rootSessions = snapshot.sessions.filter(
          (s) => !s.parentCascadeId && !(s.nestingDepth && s.nestingDepth > 0)
        );
        if (rootSessions.length > 0) {
          if (!activeSession || activeSession.accountId.startsWith('demo-')) {
            void loadSessionTrajectory(rootSessions[0]);
          }
        } else if (errs.length === 0) {
          setActiveSession(null);
        }
      }
    } catch (err) {
      setOnboardingMsg(String(err));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [activeSession, loadSessionTrajectory]);

  useEffect(() => {
    void refreshLiveSessions();
    void syncGetStatus()
      .then(async (st) => {
        setSyncStatus(st);
        // Auto-pull cloud vault on startup if signed in and local has 0 accounts
        if (st.signedIn) {
          const localAccs = await listAccounts().catch(() => []);
          if (localAccs.length === 0) {
            try {
              const [pulledSt, pulledAccs] = await syncPullVault();
              setSyncStatus(pulledSt);
              if (pulledAccs.length > 0) {
                setDemoMode(false);
                setAccounts(pulledAccs);
                void refreshLiveSessions();
              }
            } catch {
              // Ignore transient network errors on boot
            }
          }
        }
      })
      .catch(() => {});

    let unlistenCaptured: (() => void) | null = null;
    let unlistenSync: (() => void) | null = null;
    let unlistenOpenUrl: (() => void) | null = null;

    const handleAndroidOAuthCallback = (evt: Event) => {
      const callbackUrl = (evt as CustomEvent<string>).detail;
      if (!callbackUrl || typeof callbackUrl !== 'string') return;
      void syncCompleteOAuthCallback(callbackUrl)
        .then(async (st) => {
          setSyncStatus(st);
          setOnboardingMsg('');
          const [pulledSt, pulledAccs] = await syncPullVault();
          setSyncStatus(pulledSt);
          if (pulledAccs.length > 0) {
            setDemoMode(false);
            setAccounts(pulledAccs);
            void refreshLiveSessions();
          }
        })
        .catch((err) => {
          setOnboardingMsg(String(err));
        });
    };
    window.addEventListener('agy:oauth-callback', handleAndroidOAuthCallback);

    if (isTauriRuntime()) {
      void listen<AccountSummary>('agy:account-captured', () => {
        setDemoMode(false);
        setOnboardingMsg('');
        void refreshLiveSessions();
      }).then((fn) => {
        unlistenCaptured = fn;
      });
      void listen<SyncStatusInfo>('agy:sync-updated', (evt) => {
        setSyncStatus(evt.payload);
      }).then((fn) => {
        unlistenSync = fn;
      });
      void listen<string>('agy:open-external-url', (evt) => {
        const url = evt.payload;
        if (!url) return;
        const bridge = (window as unknown as { AgyAndroidBridge?: { openExternalUrl?: (u: string) => boolean } })
          .AgyAndroidBridge;
        if (bridge?.openExternalUrl) {
          bridge.openExternalUrl(url);
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }).then((fn) => {
        unlistenOpenUrl = fn;
      });
    }

    const handleWakeRefresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshLiveSessions();
      }
    };
    const handleOnlineRefresh = () => {
      void refreshLiveSessions();
    };
    document.addEventListener('visibilitychange', handleWakeRefresh);
    window.addEventListener('online', handleOnlineRefresh);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeRefresh);
      window.removeEventListener('online', handleOnlineRefresh);
      window.removeEventListener('agy:oauth-callback', handleAndroidOAuthCallback);
      if (unlistenCaptured) unlistenCaptured();
      if (unlistenSync) unlistenSync();
      if (unlistenOpenUrl) unlistenOpenUrl();
      if (activeStreamIdRef.current) {
        void stopAgentStream(activeStreamIdRef.current).catch(() => {});
      }
    };
  }, []);

  const handleSend = async (text: string, attachments: MediaAttachment[] = []) => {
    if (!activeSession) return;

    setTimeline((prev) => [
      ...prev,
      { id: `opt-u-${Date.now()}`, kind: 'user', stepIndex: prev.length, text, attachments },
    ]);

    if (!isTauriRuntime() || activeSession.accountId.startsWith('demo-') || !hasLiveAccount) {
      setIsRunning(true);
      setTimeout(() => {
        setTimeline((prev) => [
          ...prev,
          {
            id: `demo-asst-${Date.now()}`,
            kind: 'assistant',
            stepIndex: prev.length,
            markdown: `当前处于 **多账号 Demo 预览模式**${attachments.length > 0 ? `（已附带 ${attachments.length} 个文件/图片）` : ''}。点击右上角 **Settings** 添加一个或多个 Antigravity 账号，即可跨账号/跨设备实时发送指令与图片！`,
          },
        ]);
        setIsRunning(false);
      }, 450);
      return;
    }

    setIsRunning(true);
    try {
      const mediaPayload = attachments
        .filter((a) => a.base64)
        .map((a) => ({ mimeType: a.mimeType, inlineData: a.base64 }));
      await sendUserMessage(
        activeSession.accountId,
        activeSession.deviceUuid,
        activeSession.cascadeId,
        text,
        activeModelOption?.enumModel,
        mediaPayload.length > 0 ? mediaPayload : undefined
      );
      const r = await getTrajectorySteps(
        activeSession.accountId,
        activeSession.deviceUuid,
        activeSession.cascadeId,
        0
      );
      const norm = normalizeTrajectorySteps(r.steps || [], activeSession.cascadeId);
      setTimeline(norm.items);
      setPendingApproval(norm.pendingApproval);
      setIsRunning(norm.isRunning);
    } catch (err) {
      setIsRunning(false);
      const msg = String(err);
      const quotaErr = isQuotaLimitError(msg);
      setTimeline((prev) => [
        ...prev,
        {
          id: `send-err-${Date.now()}`,
          kind: 'error',
          stepIndex: prev.length,
          message: msg,
          isQuotaError: quotaErr,
          errorCode: quotaErr ? 'MODEL_QUOTA_LIMIT_EXCEEDED' : undefined,
        },
      ]);
    }
  };

  const handleStop = async () => {
    if (!activeSession) return;
    setIsRunning(false);
    if (isTauriRuntime() && !activeSession.accountId.startsWith('demo-')) {
      await cancelInvocation(
        activeSession.accountId,
        activeSession.deviceUuid,
        activeSession.cascadeId
      ).catch(() => {});
    }
  };

  const handleApprovalDecision = async (
    allow: boolean,
    scope: 'once' | 'session' = 'once',
    comment?: string
  ) => {
    if (!pendingApproval || !activeSession) return;
    setIsSubmittingApproval(true);
    try {
      if (isTauriRuntime() && !activeSession.accountId.startsWith('demo-')) {
        const interactionPayload = buildInteractionPayload(
          pendingApproval,
          allow,
          scope,
          comment
        );
        await handleUserInteraction(
          activeSession.accountId,
          activeSession.deviceUuid,
          activeSession.cascadeId,
          interactionPayload
        );
      }
      setPendingApproval(null);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  // Android notification actions are delivered by MainActivity as
  // `agy:native-event` with `{ event, payload }`. Without this listener the
  // receiver's Approve/Deny buttons update the notification but never reach
  // the pending interaction.
  useEffect(() => {
    const onNativeEvent = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as
        | { event?: string; payload?: { requestId?: string; decision?: string; comment?: string } }
        | undefined;
      if (detail?.event !== 'agy:permission-action') return;
      const requestId = String(detail.payload?.requestId || '');
      if (requestId && pendingApprovalKeyRef.current && requestId !== pendingApprovalKeyRef.current) {
        // Stale notification action: the pending approval has already changed.
        return;
      }
      const decision = String(detail.payload?.decision || '');
      if (!decision) return;
      void handleApprovalDecision(decision === 'APPROVE', 'once', detail.payload?.comment);
    };
    window.addEventListener('agy:native-event', onNativeEvent);
    return () => window.removeEventListener('agy:native-event', onNativeEvent);
  }, [pendingApproval, activeSession]);

  // Mirror a pending approval to the Android notification shade while the app
  // is backgrounded. MainActivity forwards the resulting action back through
  // the `agy:native-event` listener above.
  useEffect(() => {
    if (!pendingApproval) {
      pendingApprovalKeyRef.current = null;
      return;
    }
    const key = `${pendingApproval.trajectoryId}:${pendingApproval.stepIndex}:${pendingApproval.kind}`;
    pendingApprovalKeyRef.current = key;
    const bridge = (
      window as unknown as {
        AgyAndroidBridge?: {
          showPermissionNotification?: (
            toolName: string,
            commandText: string,
            requestId: string
          ) => boolean;
        };
      }
    ).AgyAndroidBridge;
    if (!bridge?.showPermissionNotification) return;

    const notify = () => {
      if (document.visibilityState === 'visible') return;
      bridge.showPermissionNotification?.(
        pendingApproval.toolName,
        pendingApproval.commandOrDiff || pendingApproval.title,
        key
      );
    };
    notify();
    document.addEventListener('visibilitychange', notify);
    return () => document.removeEventListener('visibilitychange', notify);
  }, [pendingApproval]);

  const handleNewSession = async (accountId: string, deviceUuid: string) => {
    const dev = devices.find((d) => d.accountId === accountId && d.uuid === deviceUuid);
    if (!isTauriRuntime() || accountId.startsWith('demo-')) {
      const demoNew: UnifiedSessionSummary = {
        id: `${accountId}::${deviceUuid}::new-${Date.now()}`,
        accountId,
        accountLabel: dev?.accountLabel || 'Personal',
        cascadeId: `new-${Date.now()}`,
        title: 'New Session',
        snippet: 'Ready to code',
        deviceUuid,
        deviceName: dev?.displayName || 'Workstation',
        deviceStatus: 'RUNNING',
        workspaceName: 'Workspace',
        lastModifiedMs: Date.now(),
        status: 'idle',
      };
      setSessions((prev) => [demoNew, ...prev]);
      setActiveSession(demoNew);
      setTimeline([]);
      setPendingApproval(null);
      return;
    }

    try {
      // StartCascadeRequest has no project_id and expects workspace_uris.
      // Resolve the paired machine's first workspace so the new cascade is not
      // created workspace-less.
      let workspaceUri: string | undefined;
      try {
        const rawWorkspaces = (await getWorkspaceInfos(accountId, deviceUuid)) as {
          workspaceInfos?: Array<{ workspaceUri?: string }>;
          homeDirUri?: string;
        } | null;
        workspaceUri =
          rawWorkspaces?.workspaceInfos?.find((w) => Boolean(w.workspaceUri))?.workspaceUri ||
          rawWorkspaces?.homeDirUri ||
          undefined;
      } catch {
        // Fall back to the previous behavior if the machine has no workspace
        // listing endpoint available.
      }
      const res = await startCascade(accountId, deviceUuid, workspaceUri);
      if (res.cascadeId) {
        const created: UnifiedSessionSummary = {
          id: `${accountId}::${deviceUuid}::${res.cascadeId}`,
          accountId,
          accountLabel: dev?.accountLabel || 'Account',
          cascadeId: res.cascadeId,
          title: 'New Session',
          snippet: 'Just started',
          deviceUuid,
          deviceName: dev?.displayName || deviceUuid.slice(0, 8),
          deviceStatus: dev?.status || 'RUNNING',
          workspaceName: 'Workspace',
          lastModifiedMs: Date.now(),
          status: 'idle',
        };
        setSessions((prev) => [created, ...prev]);
        void loadSessionTrajectory(created);
      }
    } catch (err) {
      setTimeline([
        { id: 'start-err', kind: 'error', stepIndex: 0, message: `StartCascade failed: ${String(err)}` },
      ]);
    }
  };

  const diffTotals = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const d of allDiffs) {
      add += d.additions;
      del += d.deletions;
    }
    if (add === 0 && del === 0) {
      for (const item of timeline) {
        if (item.kind === 'tool' && item.tool.category === 'edit') {
          add += item.tool.additions || 0;
          del += item.tool.deletions || 0;
        }
      }
    }
    return { add, del };
  }, [allDiffs, timeline]);

  return (
    <I18nContext.Provider value={i18nValue}>
      <div
        className="flex flex-row h-full w-full overflow-hidden"
        style={{ background: 'var(--bg-canvas)' }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch.clientX <= 28 && !drawerOpen && !sheet) {
            edgeTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
          } else {
            edgeTouchStartRef.current = null;
          }
        }}
        onTouchEnd={(e) => {
          const start = edgeTouchStartRef.current;
          edgeTouchStartRef.current = null;
          if (!start) return;
          const touch = e.changedTouches[0];
          const dx = touch.clientX - start.x;
          const dy = Math.abs(touch.clientY - start.y);
          if (dx > 48 && dy < 72) {
            setDrawerOpen(true);
          }
        }}
      >
        {/* Claude Desktop Persistent Left Sidebar (>= 960px / lg) */}
        {desktopSidebarOpen && (
          <div className="hidden lg:flex h-full shrink-0">
            <SessionDrawer
              open
              variant="sidebar"
              accounts={accounts}
              accountErrors={accountErrors}
              syncStatus={syncStatus}
              devices={devices}
              sessions={sessions}
              activeSessionId={activeSession?.id || ''}
              isLoading={isLoadingSessions}
              onClose={() => setDesktopSidebarOpen(false)}
              onSelectSession={(s) => void loadSessionTrajectory(s)}
              onNewSession={(accId, devUuid) => void handleNewSession(accId, devUuid)}
              onRefresh={() => void refreshLiveSessions()}
              onOpenSettings={() => setSheet({ kind: 'Settings' })}
            />
          </div>
        )}

        {/* Main Adaptive Agent Column (Claude Desktop centered reading column / Claude Mobile full-width) */}
        <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
          <TopBar
            session={activeSession}
            hasPendingApproval={Boolean(pendingApproval)}
            totalAdditions={diffTotals.add}
            totalDeletions={diffTotals.del}
            taskCount={tasks.length}
            isLiveConnected={isLiveConnected}
            onOpenCommandPalette={() => setCommandOpen(true)}
        onOpenDrawer={() => {
              if (window.innerWidth >= 1024) {
                setDesktopSidebarOpen((v) => !v);
              } else {
                setDrawerOpen(true);
              }
            }}
        onOpenDevices={() => setSheet({ kind: 'DeviceSessions' })}
        onOpenDiff={() => {
          const combined =
            allDiffs.length > 0
              ? allDiffs.map((d) => `--- ${d.filePath}\n${d.diff}`).join('\n\n')
              : timeline
                  .filter(
                    (i): i is Extract<TimelineItem, { kind: 'tool' }> =>
                      i.kind === 'tool' && i.tool.category === 'edit'
                  )
                  .map((i) => `--- ${i.tool.filePath || i.tool.summary}\n${i.tool.diffContent || i.tool.detail}`)
                  .join('\n\n');
          setSheet({
            kind: 'DiffView',
            title: i18nValue.t('workspaceChanges'),
            filePath: allDiffs[0]?.filePath || 'src-tauri/src/protocol/client.rs',
            diff: combined || 'No diffs yet.',
          });
        }}
        onOpenTasks={() => setSheet({ kind: 'TaskList', tasks })}
        onOpenSettings={() => setSheet({ kind: 'Settings' })}
      />

      {accountErrors.length > 0 && !(inTauri && !hasLiveAccount && !demoMode) && (() => {
        const expired = accountErrors.filter((e) => e.code === 'SESSION_EXPIRED');
        const isExp = expired.length > 0;
        const names = (isExp ? expired : accountErrors).map((e) => e.accountLabel).join(', ');
        return (
          <div
            className="shrink-0 border-b px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[0.78rem]"
            style={{
              background: isExp ? 'rgba(220, 38, 38, 0.09)' : 'rgba(245, 158, 11, 0.1)',
              borderColor: isExp ? 'rgba(220, 38, 38, 0.25)' : 'rgba(245, 158, 11, 0.28)',
              color: isExp ? 'var(--red)' : 'var(--amber)',
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="leading-snug">
                {isExp
                  ? i18nValue.t('sessionExpiredBanner', { accounts: names })
                  : i18nValue.t('networkErrorBanner', { accounts: names })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isExp && (
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'Settings' })}
                  className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[0.73rem] font-semibold cursor-pointer"
                  style={{ background: 'var(--red)', color: '#fff' }}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{i18nValue.t('reauthBtn')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void refreshLiveSessions()}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[0.73rem] font-semibold border cursor-pointer"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSessions ? 'animate-spin' : ''}`} />
                <span>{i18nValue.t('retryBtn')}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {inTauri && !hasLiveAccount && !demoMode ? (
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:py-10 flex flex-col">
          <div
            className="w-full max-w-md my-auto mx-auto rounded-3xl p-5 sm:p-6 space-y-4"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="space-y-1.5 text-center">
              <div
                className="w-11 h-11 mx-auto rounded-2xl flex items-center justify-center mb-2.5"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Sparkles className="w-5 h-5" />
              </div>
              <h2 className="text-[1.08rem] font-bold tracking-tight">
                {i18nValue.resolved === 'en' ? 'Connect Google Antigravity' : '连接你的 Google Antigravity'}
              </h2>
              <p className="text-[0.8rem] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {i18nValue.resolved === 'en'
                  ? 'Paste Cookies / cURL or import a cookies.txt / JSON file directly — supports instant PC ↔ Mobile Cloud Sync.'
                  : '优先直接粘贴文本 Cookies / cURL 或选择 cookies.txt / JSON 文件导入，导入后支持一键云端同步至手机端。'}
              </p>
            </div>

            {onboardingMsg && (
              <div
                className="rounded-xl px-3.5 py-2.5 text-[0.76rem] break-words"
                style={{ background: 'var(--bg-elevated)', color: 'var(--accent)' }}
              >
                {onboardingMsg}
              </div>
            )}

            {/* Priority 1: Direct Text Cookies or Cookie File Import */}
            <div
              className="rounded-2xl p-3.5 space-y-2.5"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[0.82rem] font-semibold">
                  <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  <span>
                    {i18nValue.resolved === 'en' ? 'Import Cookies (Text / File)' : '导入文本或文件 Cookies'}
                  </span>
                </div>
                <input
                  ref={cookieFileInputRef}
                  type="file"
                  accept=".txt,.json,.cookies,text/plain,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setOnboardingCookieText(text);
                    if (!onboardingLabel) {
                      setOnboardingLabel(file.name.replace(/\.(txt|json|cookies)$/i, ''));
                    }
                    setOnboardingMsg(
                      i18nValue.resolved === 'en'
                        ? `Loaded "${file.name}" (${text.length} chars) — tap Import & Connect.`
                        : `已读取文件「${file.name}」（${text.length} 字符），点击下方按钮即可导入连接。`
                    );
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => cookieFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[0.75rem] font-medium cursor-pointer shrink-0"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>{i18nValue.resolved === 'en' ? 'Select File' : '选择文件'}</span>
                </button>
              </div>

              <input
                type="text"
                value={onboardingLabel}
                onChange={(e) => setOnboardingLabel(e.target.value)}
                placeholder={i18nValue.resolved === 'en' ? 'Account label (optional, e.g. Personal)' : '账号备注名（可选，如 Personal）'}
                className="w-full h-9 px-3 rounded-xl text-[0.8rem] outline-none"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />

              <textarea
                rows={3}
                value={onboardingCookieText}
                onChange={(e) => setOnboardingCookieText(e.target.value)}
                placeholder={
                  i18nValue.resolved === 'en'
                    ? 'Paste Cookie header, Copy as cURL, Cookie-Editor JSON, or Netscape cookies.txt…'
                    : '粘贴 Cookie 文本、Copy as cURL、Cookie-Editor JSON 或 Netscape cookies.txt 内容…'
                }
                className="w-full p-2.5 rounded-xl text-[0.76rem] font-mono outline-none resize-none"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />

              <button
                type="button"
                disabled={onboardingBusy || !onboardingCookieText.trim()}
                onClick={async () => {
                  setOnboardingBusy(true);
                  setOnboardingMsg(
                    i18nValue.resolved === 'en'
                      ? 'Verifying cookies with Google Antigravity…'
                      : '正在向 Google Antigravity 验证 Cookies 有效性…'
                  );
                  try {
                    await importAccountCookies({
                      label: onboardingLabel.trim() || undefined,
                      rawInput: onboardingCookieText.trim(),
                    });
                    setOnboardingCookieText('');
                    setOnboardingLabel('');
                    setOnboardingMsg('');
                    setDemoMode(false);
                    await refreshLiveSessions();
                  } catch (err) {
                    setOnboardingMsg(String(err));
                  } finally {
                    setOnboardingBusy(false);
                  }
                }}
                className="w-full min-h-[44px] rounded-xl px-4 py-2.5 text-[0.86rem] font-semibold text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45"
                style={{ background: 'var(--accent)' }}
              >
                <KeyRound className="w-4 h-4" />
                <span>{i18nValue.resolved === 'en' ? 'Import Cookies & Connect' : '立即导入 Cookies 并连接'}</span>
              </button>
            </div>

            {/* Priority 2: 1-Tap Google Cloud Sync */}
            <button
              type="button"
              disabled={onboardingBusy}
              onClick={async () => {
                setOnboardingBusy(true);
                setOnboardingMsg(
                  i18nValue.resolved === 'en'
                    ? 'Waiting for Google Cloud Sync SSO in browser…'
                    : '正在通过浏览器完成一键 Google 云同步登录…'
                );
                try {
                  const st = await syncStartGoogleOAuth();
                  setSyncStatus(st);
                  if (!st.signedIn) {
                    setOnboardingMsg(
                      i18nValue.resolved === 'en'
                        ? 'Complete Google sign-in in your browser — Antigravity will resume automatically.'
                        : '请在系统浏览器中完成 Google 登录，授权后将自动返回并同步账号…'
                    );
                    return;
                  }
                  const [pulledSt, updated] = await syncPullVault();
                  setSyncStatus(pulledSt);
                  if (updated.length > 0) {
                    setAccounts(updated);
                    setOnboardingMsg('');
                    void refreshLiveSessions();
                  } else {
                    setOnboardingMsg(
                      i18nValue.resolved === 'en'
                        ? 'Cloud Sync signed in! Import cookies on any device and it will auto-sync.'
                        : '云同步已登录！在任意一端导入 Cookies 后即可自动同步到所有设备。'
                    );
                  }
                } catch (err) {
                  setOnboardingMsg(String(err));
                } finally {
                  setOnboardingBusy(false);
                }
              }}
              className="w-full min-h-[42px] rounded-xl px-4 py-2 text-[0.83rem] font-medium flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              <Cloud className="w-4 h-4" />
              <span>
                {syncStatus.signedIn
                  ? i18nValue.resolved === 'en'
                    ? `Pull Cloud Vault (${syncStatus.user?.email || 'Synced'})`
                    : `从云端拉取账号（${syncStatus.user?.email || '已登录'}）`
                  : i18nValue.resolved === 'en'
                    ? '1-Tap Google Cloud Sync (PC ↔ Mobile)'
                    : '一键 Google 云同步（PC ↔ 手机自动拉取）'}
              </span>
            </button>

            {/* Priority 3 (Last Resort): Manual Antigravity Website Login + Demo */}
            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              <button
                type="button"
                disabled={onboardingBusy}
                onClick={async () => {
                  setOnboardingBusy(true);
                  setOnboardingMsg(
                    i18nValue.resolved === 'en'
                      ? 'Opened Antigravity website login window — cookies will auto-capture once signed in.'
                      : '已打开 Antigravity 官网登录窗，登录完成后将自动捕获 Cookie…'
                  );
                  try {
                    await openGoogleLogin();
                  } catch (err) {
                    setOnboardingMsg(String(err));
                  } finally {
                    setOnboardingBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1 py-1.5 underline underline-offset-2 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>
                  {i18nValue.resolved === 'en' ? 'Or sign in via website (fallback)' : '或手动登录官网获取（备选）'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDemoMode(true);
                  setAccounts(DEMO_ACCOUNTS);
                  setDevices(DEMO_DEVICES);
                  setSessions(DEMO_SESSIONS);
                  setActiveSession(DEMO_SESSIONS[0]);
                  setTimeline(DEMO_TIMELINE);
                  setPendingApproval(DEMO_APPROVAL);
                  setTasks(DEMO_TASKS);
                }}
                className="py-1.5 underline underline-offset-2 cursor-pointer"
              >
                {i18nValue.resolved === 'en' ? 'Try Demo UI' : '体验演示数据'}
              </button>
            </div>
          </div>
        </main>
      ) : (
        <>
          {activeSubagents.length > 0 && (
            <div
              className="shrink-0 border-b px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            >
              <span
                className="text-[0.7rem] font-semibold uppercase tracking-wide shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                {i18nValue.resolved === 'en'
                  ? `Subagents (${activeSubagents.length})`
                  : `子代理 (${activeSubagents.length})`}
              </span>
              {activeSubagents.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setSheet({ kind: 'SubagentView', subagent: sub })}
                  className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[0.73rem] font-medium shrink-0 active:scale-95 cursor-pointer"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: sub.status === 'running' ? 'var(--accent)' : 'var(--green)' }}
                  />
                  <span className="max-w-[180px] truncate">{sub.subagentRole || sub.title}</span>
                  {typeof sub.stepCount === 'number' && sub.stepCount > 0 && (
                    <span className="text-[0.66rem]" style={{ color: 'var(--text-muted)' }}>
                      {sub.stepCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <AgentTimeline
            items={timeline}
            isRunning={isRunning}
            onOpenSheet={setSheet}
            onAnswerQuestion={(_qId, ans) => void handleSend(ans, [])}
          />
        </>
      )}

      {pendingApproval && !(inTauri && !hasLiveAccount && !demoMode) && (
        <ApprovalBanner
          approval={pendingApproval}
          isSubmitting={isSubmittingApproval}
          onInspect={() => setSheet({ kind: 'ApprovalDiffDetail', approval: pendingApproval })}
          onApprove={(scope) => void handleApprovalDecision(true, scope)}
          onDeny={() => void handleApprovalDecision(false)}
        />
      )}

      {!(inTauri && !hasLiveAccount && !demoMode) &&
        activeModelOption &&
        typeof activeModelOption.remainingFraction === 'number' &&
        activeModelOption.remainingFraction <= 0.001 && (
          <div
            className="shrink-0 mx-3 md:mx-auto md:max-w-3xl w-[calc(100%-1.5rem)] mb-1.5 rounded-2xl border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[0.77rem]"
            style={{
              background: 'rgba(245, 158, 11, 0.09)',
              borderColor: 'rgba(245, 158, 11, 0.32)',
            }}
          >
            <div className="flex items-center gap-2 min-w-0" style={{ color: 'var(--amber)' }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="truncate font-medium">
                {i18nValue.t('modelExhaustedInline', {
                  model: activeModelOption.displayName,
                  reset: activeModelOption.resetTimeMs
                    ? ` (${i18nValue.t('quotaResetIn', { time: formatResetCountdown(activeModelOption.resetTimeMs) })})`
                    : '',
                })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSheet({ kind: 'ModelPicker' })}
                className="px-2.5 h-7 rounded-lg text-[0.72rem] font-semibold cursor-pointer"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {i18nValue.t('switchModelBtn')}
              </button>
              <button
                type="button"
                onClick={() => setSheet({ kind: 'Settings', subPage: 'usage' })}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[0.72rem] font-semibold border cursor-pointer"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              >
                <Gauge className="w-3 h-3" />
                <span>{i18nValue.t('quotaDashboard')}</span>
              </button>
            </div>
          </div>
        )}

      {!(inTauri && !hasLiveAccount && !demoMode) && (
        <Composer
          permissionMode={permissionMode}
          activeModel={activeModel}
          serverSlashCommands={remoteSlashCommands}
          isRunning={isRunning}
          onSend={(t, atts) => void handleSend(t, atts)}
          onStop={() => void handleStop()}
          onOpenPermissionSheet={() => setSheet({ kind: 'PermissionModeSelection' })}
          onOpenModelSheet={() => setSheet({ kind: 'ModelPicker' })}
        />
      )}

      <SessionDrawer
        open={drawerOpen}
        accounts={accounts}
        accountErrors={accountErrors}
        syncStatus={syncStatus}
        devices={devices}
        sessions={sessions}
        activeSessionId={activeSession?.id || ''}
        isLoading={isLoadingSessions}
        onClose={() => setDrawerOpen(false)}
        onSelectSession={(s) => void loadSessionTrajectory(s)}
        onNewSession={(accId, devUuid) => void handleNewSession(accId, devUuid)}
        onRefresh={() => void refreshLiveSessions()}
        onOpenSettings={() => setSheet({ kind: 'Settings' })}
      />

      <BottomSheet
        sheet={sheet}
        accounts={accounts}
        demoMode={demoMode}
        syncStatus={syncStatus}
        theme={theme}
        fontSize={fontSize}
        permissionMode={permissionMode}
        activeModel={activeModel}
        availableModels={availableModels}
        devices={devices}
        sessions={sessions}
        onClose={() => setSheet(null)}
        onChangeTheme={setTheme}
        onChangeFontSize={setFontSize}
        onChangePermissionMode={setPermissionMode}
        onChangeModel={setActiveModel}
        onSelectSession={(s) => void loadSessionTrajectory(s)}
        onApprove={(scope) => void handleApprovalDecision(true, scope)}
        onDeny={() => void handleApprovalDecision(false)}
        onOpenGoogleLogin={openGoogleLogin}
        onHarvestLoginCookies={async (label) => {
          await harvestLoginCookies({ label });
          await refreshLiveSessions();
        }}
        onImportAccountCookies={async (label, raw) => {
          await importAccountCookies({ label, rawInput: raw });
          await refreshLiveSessions();
        }}
        onToggleAccount={async (accountId, enabled) => {
          const updated = await toggleAccount(accountId, enabled);
          setAccounts(updated);
          void refreshLiveSessions();
        }}
        onRemoveAccount={async (accountId) => {
          const updated = await removeAccount(accountId);
          setAccounts(updated);
          void refreshLiveSessions();
        }}
        onExportVault={exportVaultJson}
        onImportVault={async (rawJson) => {
          const updated = await importVaultJson(rawJson);
          setDemoMode(false);
          setAccounts(updated);
          void refreshLiveSessions();
        }}
        onSyncSetServerUrl={async (url) => {
          const st = await syncSetServerUrl(url);
          setSyncStatus(st);
        }}
        onSyncStartGoogleOAuth={async () => {
          const st = await syncStartGoogleOAuth();
          setSyncStatus(st);
          if (!st.signedIn) return;
          // Auto-pull cloud vault if local is empty; otherwise auto-push local accounts to cloud!
          try {
            const localAccs = await listAccounts().catch(() => []);
            const [pulledSt, pulledAccs] = await syncPullVault();
            setSyncStatus(pulledSt);
            if (pulledAccs.length > 0) {
              setDemoMode(false);
              setAccounts(pulledAccs);
              void refreshLiveSessions();
            } else if (localAccs.length > 0) {
              const pushedSt = await syncPushVault();
              setSyncStatus(pushedSt);
            }
          } catch {
            // Keep signed-in state even if initial vault pull/push fails
          }
        }}
        onSyncLoginGoogleIdToken={async (idToken) => {
          const st = await syncLoginGoogleIdToken(idToken);
          setSyncStatus(st);
        }}
        onSyncLoginDevSso={async (email) => {
          const st = await syncLoginDevSso(email);
          setSyncStatus(st);
        }}
        onSyncLogout={async () => {
          const st = await syncLogout();
          setSyncStatus(st);
        }}
        onSyncPush={async () => {
          const st = await syncPushVault();
          setSyncStatus(st);
        }}
        onSyncPull={async () => {
          const [st, updated] = await syncPullVault();
          setSyncStatus(st);
          if (updated.length > 0) setAccounts(updated);
          void refreshLiveSessions();
        }}
      />

      <CommandPalette
        open={commandOpen}
        sessions={sessions}
        devices={devices}
        accounts={accounts}
        onClose={() => setCommandOpen(false)}
        onSelectSession={(session) => void loadSessionTrajectory(session)}
        onNewSession={(accountId, deviceUuid) => void handleNewSession(accountId, deviceUuid)}
        onOpenSettings={() => setSheet({ kind: 'Settings' })}
        onOpenUsage={() => setSheet({ kind: 'Settings', subPage: 'usage' })}
      />
        </div>
      </div>
    </I18nContext.Provider>
  );
}
