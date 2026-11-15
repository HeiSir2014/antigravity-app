// Multi-Device Remote Session Aggregator for Google Antigravity
// Reverse-engineered from boq-jetski.GoogleAntigravity (jetski_base.js, jetski_Mc2QKe.js, jetski_PGmR6b.js).
//
// Solves Antigravity Web's "Select Device First" limitation by:
// 1. Enumerating all paired Remote Control machines via:
//    /$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances
// 2. Fanning out stateless multiplexed ProxyCommand RPCs across ALL online machines in parallel:
//    /$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand
//    - target_instance_uuid: <device.uuid>
//    - rpc_path: "/exa.language_server_pb.LanguageServerService/SearchConversations"
//    - payload: UTF-8 JSON {"query":"","limit":25}
// 3. Merging Cloud (__remote_conversations__) + all Device sessions into a single
//    Claude Code-style unified session feed, with 1-tap deep-linking to:
//    /r/<device.uuid>?p=c%2F<cascadeId>%3Fproject%3D<projectId>%26tab%3D<tab>

import {
  getUnifiedTheme,
  setUnifiedTheme,
  subscribeUnifiedTheme,
  type UnifiedThemeMode,
} from './dom-safe';

export interface AgyDeviceInstance {
  uuid: string;
  displayName: string;
  version: string;
  status: 'RUNNING' | 'IDLE' | 'DISCONNECTED';
  lastActiveMs: number;
  group: 'remoteConversations' | 'instances';
}

export interface UnifiedRemoteSession {
  id: string; // `${deviceUuid}::${cascadeId}`
  cascadeId: string;
  title: string;
  snippet?: string;
  deviceUuid: string;
  deviceName: string;
  deviceStatus: 'RUNNING' | 'IDLE' | 'DISCONNECTED';
  projectId: string;
  workspaceName: string;
  lastModifiedMs: number;
  lastModifiedLabel: string;
  status: 'running' | 'waiting_approval' | 'idle';
  activeTab?: 'chat' | 'review' | 'files' | 'terminal';
}

export interface GeminiChatThread {
  id: string;
  title: string;
  url: string;
  updatedAtMs: number;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl?: string;
  tier?: string;
}

export interface UnifiedAppState {
  activeEngine: 'gemini' | 'antigravity';
  theme?: UnifiedThemeMode;
  userProfile?: UserProfile;
  currentInstanceUuid: string;
  currentCascadeId: string;
  currentProjectId: string;
  currentTab: 'chat' | 'review' | 'files' | 'terminal';
  devices: AgyDeviceInstance[];
  sessions: UnifiedRemoteSession[];
  geminiChats: GeminiChatThread[];
  lastSyncedMs: number;
}

const CACHE_KEY = 'agy.unifiedAppState.v1';

// References captured from window.default_GoogleAntigravity & __JETSKI_LS_CLIENT_DECORATOR__
let capturedGrpcClient: any = null;
let capturedRemoteControlComp: any = null;
let capturedLsClient: any = null;
const stateListeners = new Set<(state: UnifiedAppState) => void>();

export function isValidGeminiChatThread(item: unknown): item is GeminiChatThread {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Record<string, unknown>;
  const id = String(candidate.id || '').trim();
  const rawTitle = String(candidate.title || '').trim();
  if (!id || !rawTitle) return false;

  const titleLower = rawTitle.toLowerCase();
  const idLower = id.toLowerCase();

  // Basic length constraints
  if (rawTitle.length < 2 || rawTitle.length > 250) return false;

  // Forbidden exact titles and words
  const forbiddenKeywords = [
    'sign in',
    'signin',
    'log in',
    'login',
    'sign up',
    'signup',
    'get started',
    'get gemini',
    'try gemini',
    'upgrade',
    '登录',
    '登入',
    '注册',
    '开始使用',
    '升级',
    'main menu',
    '主菜单',
    'menu',
    '菜单',
    'settings',
    '设置',
    'help',
    '帮助',
    'feedback',
    '反馈',
    'privacy',
    '隐私',
    'terms',
    '条款',
    'faq',
    'new chat',
    '新建对话',
    '新对话',
    'chats',
    'conversations',
    'pinned',
    '置顶',
    'recent',
    '最近',
    'activity',
    '活动记录',
    'gem manager',
    'gems',
    'extensions',
    '扩展',
    'updates',
    '更新',
    'google account',
    'google 账号',
    'google 帳號',
  ];

  for (const kw of forbiddenKeywords) {
    if (titleLower === kw) return false;
    if (titleLower.startsWith(kw + ' ') || titleLower.endsWith(' ' + kw)) return false;
  }

  // Regex checks for "sign in", "login", etc.
  if (/\b(sign in|log in|signin|login|sign-in|log-in)\b/i.test(titleLower)) return false;
  if (/^(登录|登入|注册)/.test(titleLower)) return false;

  // Forbidden IDs
  const forbiddenIds = new Set([
    'signin',
    'login',
    'auth',
    'settings',
    'help',
    'upgrade',
    'prompts',
    'apps',
    'privacy',
    'terms',
    'faq',
    'account',
    'home',
    'app',
    'new',
  ]);
  if (forbiddenIds.has(idLower)) return false;

  return true;
}

export function loadCachedUnifiedState(): UnifiedAppState {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UnifiedAppState;
      if (parsed && Array.isArray(parsed.devices) && Array.isArray(parsed.sessions)) {
        parsed.geminiChats = (parsed.geminiChats || []).filter(isValidGeminiChatThread);
        return parsed;
      }
    }
  } catch {
    // Ignore storage restriction errors
  }
  const routeInfo = parseCurrentAgyRoute();
  return {
    activeEngine: window.location.hostname.includes('gemini.google.com') ? 'gemini' : 'antigravity',
    theme: getUnifiedTheme(),
    currentInstanceUuid: routeInfo.instanceUuid,
    currentCascadeId: routeInfo.cascadeId,
    currentProjectId: routeInfo.projectId,
    currentTab: routeInfo.tab,
    devices: [
      {
        uuid: '__remote_conversations__',
        displayName: 'Cloud Environments',
        version: 'cloud',
        status: 'RUNNING',
        lastActiveMs: Date.now(),
        group: 'remoteConversations',
      },
    ],
    sessions: [],
    geminiChats: [],
    lastSyncedMs: 0,
  };
}

let currentState: UnifiedAppState = loadCachedUnifiedState();

export function getUnifiedState(): UnifiedAppState {
  return currentState;
}

export function subscribeUnifiedState(listener: (state: UnifiedAppState) => void): () => void {
  stateListeners.add(listener);
  listener(currentState);
  return () => stateListeners.delete(listener);
}

function mergeUnifiedStates(
  base: UnifiedAppState,
  incoming: Partial<UnifiedAppState>
): UnifiedAppState {
  const mergedDevices =
    incoming.devices && incoming.devices.length > 0 ? incoming.devices : base.devices;
  const mergedSessions =
    incoming.sessions && incoming.sessions.length > 0 ? incoming.sessions : base.sessions;
  const mergedGeminiChats =
    incoming.geminiChats !== undefined
      ? incoming.geminiChats.filter(isValidGeminiChatThread)
      : (base.geminiChats || []).filter(isValidGeminiChatThread);

  return {
    ...base,
    ...incoming,
    devices: mergedDevices,
    sessions: mergedSessions,
    geminiChats: mergedGeminiChats,
    theme: incoming.theme || base.theme || getUnifiedTheme(),
    currentInstanceUuid: incoming.currentInstanceUuid || base.currentInstanceUuid,
    currentCascadeId: incoming.currentCascadeId || base.currentCascadeId,
    currentProjectId: incoming.currentProjectId || base.currentProjectId,
    currentTab: incoming.currentTab || base.currentTab,
  };
}

function saveAndBroadcastState(partial: Partial<UnifiedAppState>): void {
  const routeInfo = parseCurrentAgyRoute();
  currentState = mergeUnifiedStates(currentState, {
    ...partial,
    currentInstanceUuid:
      partial.currentInstanceUuid ?? (routeInfo.instanceUuid || currentState.currentInstanceUuid),
    currentCascadeId:
      partial.currentCascadeId ?? (routeInfo.cascadeId || currentState.currentCascadeId),
    currentProjectId:
      partial.currentProjectId ?? (routeInfo.projectId || currentState.currentProjectId),
    currentTab: partial.currentTab ?? routeInfo.tab,
    lastSyncedMs: Date.now(),
  });
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(currentState));
  } catch {
    // Ignore quota/storage errors
  }
  for (const listener of stateListeners) {
    try {
      listener(currentState);
    } catch {
      // Ignore listener errors
    }
  }
  // Sync across WebViews via Tauri IPC or AndroidBridge
  syncStateToNativeHost(currentState);
}

let lastNativeSyncedJson = '';

function syncStateToNativeHost(state: UnifiedAppState): void {
  const json = JSON.stringify(state);
  if (json === lastNativeSyncedJson) return;
  lastNativeSyncedJson = json;

  const tauriInvoke = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  }).__TAURI_INTERNALS__?.invoke;

  if (tauriInvoke) {
    void tauriInvoke('sync_unified_state', {
      stateJson: json,
    }).catch(() => {});
  }

  const androidBridge = (window as unknown as {
    AndroidBridge?: { syncUnifiedState?: (json: string) => void };
  }).AndroidBridge;
  if (androidBridge?.syncUnifiedState) {
    try {
      androidBridge.syncUnifiedState(json);
    } catch {
      // Ignore
    }
  }
}

export async function pullStateFromNativeHost(): Promise<UnifiedAppState> {
  let rawJson = '';
  const tauriInvoke = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<string> };
  }).__TAURI_INTERNALS__?.invoke;

  if (tauriInvoke) {
    try {
      rawJson = (await tauriInvoke('get_unified_state')) || '';
    } catch {
      // Ignore
    }
  } else {
    const androidBridge = (window as unknown as {
      AndroidBridge?: { getUnifiedState?: () => string };
    }).AndroidBridge;
    if (androidBridge?.getUnifiedState) {
      try {
        rawJson = androidBridge.getUnifiedState() || '';
      } catch {
        // Ignore
      }
    }
  }

  if (rawJson) {
    try {
      const hostState = JSON.parse(rawJson) as UnifiedAppState;
      if (hostState && typeof hostState === 'object') {
        currentState = mergeUnifiedStates(currentState, hostState);
        if (currentState.theme === 'dark' || currentState.theme === 'light') {
          setUnifiedTheme(currentState.theme, false);
        }
        for (const listener of stateListeners) {
          listener(currentState);
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }
  return currentState;
}

subscribeUnifiedTheme((theme) => {
  if (currentState.theme !== theme) {
    saveAndBroadcastState({ theme });
  }
});

(window as unknown as { __AGY_PULL_UNIFIED_STATE__?: () => void }).__AGY_PULL_UNIFIED_STATE__ =
  () => {
    void pullStateFromNativeHost();
  };

/**
 * Parses URLs like:
 * - https://antigravity.google.com/r/<instance-uuid>?p=c%2F<cascade-id>%3Fproject%3Ddefault-cli-project%26tab%3Dreview
 * - https://antigravity.google.com/remote/c/<cascade-id>
 */
export function parseCurrentAgyRoute(): {
  surface: 'remote-control' | 'remote-agents' | 'gemini';
  instanceUuid: string;
  cascadeId: string;
  projectId: string;
  tab: 'chat' | 'review' | 'files' | 'terminal';
} {
  if (window.location.hostname.includes('gemini.google.com')) {
    return {
      surface: 'gemini',
      instanceUuid: '',
      cascadeId: '',
      projectId: '',
      tab: 'chat',
    };
  }

  const pathname = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);

  // Case 1: /r/:uuid?p=c%2F<cascadeId>%3Fproject%3D<project>%26tab%3D<tab>
  const rMatch = /^\/r\/([^/?#]+)/.exec(pathname);
  if (rMatch) {
    const instanceUuid = decodeURIComponent(rMatch[1]);
    const rawChildPath = searchParams.get('p') || '';
    let cascadeId = '';
    let projectId = 'default-cli-project';
    let tab: 'chat' | 'review' | 'files' | 'terminal' = 'chat';

    if (rawChildPath) {
      const qIdx = rawChildPath.indexOf('?');
      const childPathPart = qIdx >= 0 ? rawChildPath.slice(0, qIdx) : rawChildPath;
      const childQueryPart = qIdx >= 0 ? rawChildPath.slice(qIdx + 1) : '';
      const cMatch = /^\/?c\/([^/?#]+)/.exec(childPathPart);
      if (cMatch) {
        cascadeId = decodeURIComponent(cMatch[1]);
      }
      const childParams = new URLSearchParams(childQueryPart);
      projectId = childParams.get('project') || 'default-cli-project';
      const rawTab = childParams.get('tab');
      if (rawTab === 'review' || rawTab === 'files' || rawTab === 'terminal' || rawTab === 'chat') {
        tab = rawTab;
      }
    }

    return {
      surface: 'remote-control',
      instanceUuid,
      cascadeId,
      projectId,
      tab,
    };
  }

  // Case 2: /remote or /remote/c/:cascadeId
  const remoteMatch = /^\/remote\/(?:c\/)?([^/?#]+)/.exec(pathname);
  const cascadeId = remoteMatch && remoteMatch[1] !== 'agents' ? decodeURIComponent(remoteMatch[1]) : '';
  return {
    surface: 'remote-agents',
    instanceUuid: '__remote_conversations__',
    cascadeId,
    projectId: searchParams.get('project') || 'cloud',
    tab: 'chat',
  };
}

/**
 * Installs early hooks on globalThis.__JETSKI_LS_CLIENT_DECORATOR__ and
 * window.default_GoogleAntigravity to capture the live gRPC-Web client and RemoteControlComponent.
 */
export function installAntigravityRpcHooks(): void {
  const g = globalThis as unknown as {
    __JETSKI_LS_CLIENT_DECORATOR__?: (client: any) => any;
    default_GoogleAntigravity?: any;
  };

  // 1. Hook __JETSKI_LS_CLIENT_DECORATOR__ (used by /remote RemoteAgentsComponent in m=Mc2QKe)
  const prevDecorator = g.__JETSKI_LS_CLIENT_DECORATOR__;
  g.__JETSKI_LS_CLIENT_DECORATOR__ = (lsClient: any) => {
    capturedLsClient = prevDecorator ? prevDecorator(lsClient) : lsClient;
    void refreshAllMultiDeviceSessions();
    return capturedLsClient;
  };

  // 2. Periodically inspect window.default_GoogleAntigravity & Angular component instances
  const checkHooks = () => {
    const closureNs = g.default_GoogleAntigravity;
    if (!closureNs) return;

    // Hook GrpcClientService.prototype.getClient if available
    const GrpcClientService = closureNs.KC?.GrpcClientService;
    if (GrpcClientService?.prototype?.getClient && !GrpcClientService.prototype.__agyHooked) {
      const origGetClient = GrpcClientService.prototype.getClient;
      GrpcClientService.prototype.__agyHooked = true;
      GrpcClientService.prototype.getClient = function (this: any, ...args: any[]) {
        const client = origGetClient.apply(this, args);
        if (client && !capturedGrpcClient) {
          capturedGrpcClient = { service: this, client };
          void refreshAllMultiDeviceSessions();
        }
        return client;
      };
    }

    // Hook RemoteControlComponent.prototype.loadInstances if available
    const RemoteControlComponent = closureNs.cF?.RemoteControlComponent;
    if (RemoteControlComponent?.prototype?.loadInstances && !RemoteControlComponent.prototype.__agyHooked) {
      const origLoadInstances = RemoteControlComponent.prototype.loadInstances;
      RemoteControlComponent.prototype.__agyHooked = true;
      RemoteControlComponent.prototype.loadInstances = function (this: any, ...args: any[]) {
        capturedRemoteControlComp = this;
        if (this.grpcClient && !capturedGrpcClient) {
          try {
            capturedGrpcClient = {
              service: this.grpcClient,
              client: this.grpcClient.getClient(),
            };
          } catch {
            // Ignore
          }
        }
        const res = origLoadInstances.apply(this, args);
        void Promise.resolve(res).then(() => {
          void refreshAllMultiDeviceSessions();
        });
        return res;
      };
    }

    // Also try Angular ng.getComponent on <ga-remote-control> if already mounted
    const rcEl = document.querySelector('ga-remote-control');
    const ngGlobal = (window as unknown as { ng?: { getComponent?: (el: Element) => any } }).ng;
    if (rcEl && ngGlobal?.getComponent) {
      try {
        const comp = ngGlobal.getComponent(rcEl);
        if (comp) {
          capturedRemoteControlComp = comp;
          if (comp.grpcClient && !capturedGrpcClient) {
            capturedGrpcClient = {
              service: comp.grpcClient,
              client: comp.grpcClient.getClient(),
            };
          }
        }
      } catch {
        // Ignore if prod mode disables ng.getComponent
      }
    }
  };

  checkHooks();
  const interval = window.setInterval(checkHooks, 1500);
  window.setTimeout(() => window.clearInterval(interval), 30000);
}

/**
 * Executes a unary ProxyCommand RPC on ANY targetInstanceUuid via
 * /$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand
 */
export async function proxyUnaryRpcToDevice<T = any>(
  targetInstanceUuid: string,
  rpcPath: string,
  requestObj: Record<string, unknown> = {}
): Promise<T | null> {
  const closureNs = (globalThis as unknown as { default_GoogleAntigravity?: any }).default_GoogleAntigravity;
  const ProxyCommandRequest =
    closureNs?.pk || closureNs?.R?.devtools_jetski_boq_api_proto?.ProxyCommandRequest;

  // Fast path: if we are currently on this exact device and RemoteControlComponent is mounted
  if (
    capturedRemoteControlComp &&
    typeof capturedRemoteControlComp.selectedInstanceUuid === 'function' &&
    capturedRemoteControlComp.selectedInstanceUuid() === targetInstanceUuid &&
    typeof capturedRemoteControlComp.proxyCommand === 'function'
  ) {
    try {
      const payloadBytes = new TextEncoder().encode(JSON.stringify(requestObj));
      const { payload } = await capturedRemoteControlComp.proxyCommand(rpcPath, payloadBytes, {
        'Content-Type': 'application/json',
      });
      const text = new TextDecoder('utf-8').decode(payload);
      return JSON.parse(text) as T;
    } catch {
      // Fall through to stateless gRPC client
    }
  }

  if (!capturedGrpcClient?.client || !ProxyCommandRequest) {
    return null;
  }

  try {
    const req = new ProxyCommandRequest();
    req.setTargetInstanceUuid(targetInstanceUuid);
    req.setRpcPath(rpcPath);
    req.setPayload(new TextEncoder().encode(JSON.stringify(requestObj)));
    if (typeof req.getHeadersMap === 'function') {
      req.getHeadersMap().set('Content-Type', 'application/json');
    }

    const metadata: Record<string, string> = {
      'x-antigravity-test': 'true',
    };
    if (capturedRemoteControlComp && typeof capturedRemoteControlComp.authMetadata === 'function') {
      Object.assign(metadata, capturedRemoteControlComp.authMetadata());
    }

    const resp = await capturedGrpcClient.client.proxyCommand(req, metadata);
    const rawPayload = resp?.getPayload?.();
    let decodedText = '';
    if (rawPayload) {
      if (typeof rawPayload.asStringUtf8 === 'function') {
        decodedText = rawPayload.asStringUtf8();
      } else if (typeof rawPayload.asUint8Array === 'function') {
        decodedText = new TextDecoder('utf-8').decode(rawPayload.asUint8Array());
      } else if (rawPayload instanceof Uint8Array) {
        decodedText = new TextDecoder('utf-8').decode(rawPayload);
      } else if (typeof rawPayload === 'string') {
        decodedText = atob(rawPayload);
      }
    }
    return decodedText ? (JSON.parse(decodedText) as T) : null;
  } catch {
    return null;
  }
}

function formatRelativeTime(ms: number): string {
  if (!ms || ms <= 0) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Enumerates all paired Remote Control devices AND fans out SearchConversations
 * across all online devices concurrently to build a Claude Code-style unified session list!
 */
export async function refreshAllMultiDeviceSessions(): Promise<UnifiedAppState> {
  const closureNs = (globalThis as unknown as { default_GoogleAntigravity?: any }).default_GoogleAntigravity;
  const devices: AgyDeviceInstance[] = [
    {
      uuid: '__remote_conversations__',
      displayName: 'Cloud Environments',
      version: 'cloud',
      status: 'RUNNING',
      lastActiveMs: Date.now(),
      group: 'remoteConversations',
    },
  ];

  // 1. Gather devices from RemoteControlComponent signal or ListInstances RPC
  if (capturedRemoteControlComp && typeof capturedRemoteControlComp.instances === 'function') {
    try {
      const rawList = capturedRemoteControlComp.instances() || [];
      for (const item of rawList) {
        if (!item?.uuid) continue;
        const statusStr: 'RUNNING' | 'IDLE' | 'DISCONNECTED' =
          item.status === 1 || item.status === 'RUNNING'
            ? 'RUNNING'
            : item.status === 2 || item.status === 'IDLE'
              ? 'IDLE'
              : 'DISCONNECTED';
        devices.push({
          uuid: item.uuid,
          displayName: item.metadata?.name || item.displayName || item.uuid.slice(0, 12),
          version: item.metadata?.version || 'v2',
          status: statusStr,
          lastActiveMs: item.statusLastUpdatedAtMs || Date.now(),
          group: 'instances',
        });
      }
    } catch {
      // Ignore
    }
  } else if (capturedGrpcClient?.client && closureNs?.wk) {
    try {
      const req = new closureNs.wk();
      const resp = await capturedGrpcClient.client.listInstances(req, {
        'x-antigravity-test': 'true',
      });
      const list = resp?.getInstancesList?.() || [];
      for (const inst of list) {
        const uuid = inst.getUuid?.();
        if (!uuid) continue;
        const meta = inst.getMetadata?.();
        const rawStatus = inst.getStatus?.();
        const statusStr: 'RUNNING' | 'IDLE' | 'DISCONNECTED' =
          rawStatus === 1 ? 'RUNNING' : rawStatus === 2 ? 'IDLE' : 'DISCONNECTED';
        const ts = inst.getStatusLastUpdatedAt?.();
        const updatedMs = ts ? Number(ts.getSeconds?.() || 0) * 1000 : Date.now();
        devices.push({
          uuid,
          displayName: meta?.getName?.() || uuid.slice(0, 12),
          version: meta?.getVersion?.() || 'v2',
          status: statusStr,
          lastActiveMs: updatedMs,
          group: 'instances',
        });
      }
    } catch {
      // Ignore
    }
  }

  // Also ensure the current URL's device is ALWAYS in the devices list!
  const routeInfo = parseCurrentAgyRoute();
  if (
    routeInfo.instanceUuid &&
    routeInfo.instanceUuid !== '__remote_conversations__' &&
    !devices.some((d) => d.uuid === routeInfo.instanceUuid)
  ) {
    devices.push({
      uuid: routeInfo.instanceUuid,
      displayName: `Host (${routeInfo.instanceUuid.slice(0, 8)})`,
      version: routeInfo.instanceUuid.endsWith('-v2') ? 'v2' : 'v1',
      status: 'RUNNING',
      lastActiveMs: Date.now(),
      group: 'instances',
    });
  }

  // Also scrape DOM instance items if user opened the instance selector dropdown or /remote list
  const domInstanceNodes = document.querySelectorAll<HTMLElement>(
    '[data-testid^="remote-control-instance-"], [data-testid^="instance-selector-item-"]'
  );
  domInstanceNodes.forEach((node) => {
    const testId = node.getAttribute('data-testid') || '';
    const uuid = testId
      .replace('remote-control-instance-', '')
      .replace('instance-selector-item-', '');
    if (uuid && !devices.some((d) => d.uuid === uuid)) {
      const label = (node.textContent || '').trim().split('\n')[0] || uuid.slice(0, 12);
      devices.push({
        uuid,
        displayName: label,
        version: 'v2',
        status: 'RUNNING',
        lastActiveMs: Date.now(),
        group: 'instances',
      });
    }
  });

  // 2. Fan out SearchConversations across all online/idle devices in parallel!
  const sessionMap = new Map<string, UnifiedRemoteSession>();

  // Preserve previously cached sessions (marked according to current device status)
  for (const prev of currentState.sessions) {
    sessionMap.set(prev.id, prev);
  }

  // Ensure the active conversation from the URL is immediately represented!
  if (routeInfo.cascadeId && routeInfo.instanceUuid) {
    const dev = devices.find((d) => d.uuid === routeInfo.instanceUuid);
    const id = `${routeInfo.instanceUuid}::${routeInfo.cascadeId}`;
    const existing = sessionMap.get(id);
    const pageTitle = document.title
      .replace(/\s*[-|]\s*Google Antigravity.*$/i, '')
      .replace(/^Google Antigravity$/i, '')
      .trim();
    sessionMap.set(id, {
      id,
      cascadeId: routeInfo.cascadeId,
      title: pageTitle || existing?.title || `Session ${routeInfo.cascadeId.slice(0, 8)}`,
      snippet: existing?.snippet || `Project: ${routeInfo.projectId}`,
      deviceUuid: routeInfo.instanceUuid,
      deviceName: dev?.displayName || `Host (${routeInfo.instanceUuid.slice(0, 8)})`,
      deviceStatus: dev?.status || 'RUNNING',
      projectId: routeInfo.projectId,
      workspaceName: routeInfo.projectId,
      lastModifiedMs: Date.now(),
      lastModifiedLabel: 'Active now',
      status: 'running',
      activeTab: routeInfo.tab,
    });
  }

  // Fan out ProxyCommand("/exa.language_server_pb.LanguageServerService/SearchConversations") across all online devices
  const onlineDevices = devices.filter(
    (d) => d.group === 'instances' && (d.status === 'RUNNING' || d.status === 'IDLE')
  );

  await Promise.allSettled(
    onlineDevices.map(async (device) => {
      const searchResp = await proxyUnaryRpcToDevice<{
        results?: Array<{
          cascadeId?: string;
          title?: string;
          lastModifiedTime?: string | { seconds?: number | string };
          workspaceName?: string;
          snippet?: string;
        }>;
      }>(device.uuid, '/exa.language_server_pb.LanguageServerService/SearchConversations', {
        query: '',
        limit: 25,
      });

      const results = searchResp?.results || [];
      for (const item of results) {
        if (!item.cascadeId) continue;
        const id = `${device.uuid}::${item.cascadeId}`;
        let modifiedMs = Date.now();
        if (typeof item.lastModifiedTime === 'string') {
          const parsed = Date.parse(item.lastModifiedTime);
          if (!Number.isNaN(parsed)) modifiedMs = parsed;
        } else if (item.lastModifiedTime && typeof item.lastModifiedTime === 'object') {
          const secs = Number(item.lastModifiedTime.seconds || 0);
          if (secs > 0) modifiedMs = secs * 1000;
        }

        const isCurrentActive =
          routeInfo.instanceUuid === device.uuid && routeInfo.cascadeId === item.cascadeId;

        sessionMap.set(id, {
          id,
          cascadeId: item.cascadeId,
          title: item.title?.trim() || `Session ${item.cascadeId.slice(0, 8)}`,
          snippet: item.snippet || item.workspaceName || 'Remote Workspace',
          deviceUuid: device.uuid,
          deviceName: device.displayName,
          deviceStatus: device.status,
          projectId: item.workspaceName || 'default-cli-project',
          workspaceName: item.workspaceName || 'default-cli-project',
          lastModifiedMs: isCurrentActive ? Date.now() : modifiedMs,
          lastModifiedLabel: isCurrentActive ? 'Active now' : formatRelativeTime(modifiedMs),
          status: isCurrentActive ? 'running' : 'idle',
          activeTab: isCurrentActive ? routeInfo.tab : 'chat',
        });
      }
    })
  );

  // 3. Also query Cloud Conversations via capturedLsClient if on /remote
  if (capturedLsClient && typeof capturedLsClient.searchConversations === 'function') {
    try {
      const cloudResp = await capturedLsClient.searchConversations({ query: '', limit: 20 });
      const results = cloudResp?.results || [];
      for (const item of results) {
        if (!item.cascadeId) continue;
        const id = `__remote_conversations__::${item.cascadeId}`;
        const modifiedMs =
          typeof item.lastModifiedTime === 'string'
            ? Date.parse(item.lastModifiedTime) || Date.now()
            : Date.now();
        sessionMap.set(id, {
          id,
          cascadeId: item.cascadeId,
          title: item.title?.trim() || `Cloud Session ${item.cascadeId.slice(0, 8)}`,
          snippet: item.snippet || item.workspaceName || 'Cloud Agent',
          deviceUuid: '__remote_conversations__',
          deviceName: 'Cloud Environments',
          deviceStatus: 'RUNNING',
          projectId: item.workspaceName || 'cloud',
          workspaceName: item.workspaceName || 'cloud',
          lastModifiedMs: modifiedMs,
          lastModifiedLabel: formatRelativeTime(modifiedMs),
          status: 'idle',
          activeTab: 'chat',
        });
      }
    } catch {
      // Ignore
    }
  }

  // 4. Also scrape any visible conversation links (/c/<cascadeId>) in the current DOM
  const convLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]');
  convLinks.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const match = /\/c\/([^/?#]+)/.exec(href);
    if (!match) return;
    const cascadeId = decodeURIComponent(match[1]);
    const devUuid = routeInfo.instanceUuid || '__remote_conversations__';
    const dev = devices.find((d) => d.uuid === devUuid);
    const id = `${devUuid}::${cascadeId}`;
    if (!sessionMap.has(id)) {
      const title = (a.textContent || '').trim() || `Session ${cascadeId.slice(0, 8)}`;
      sessionMap.set(id, {
        id,
        cascadeId,
        title,
        deviceUuid: devUuid,
        deviceName: dev?.displayName || 'Remote Host',
        deviceStatus: dev?.status || 'RUNNING',
        projectId: routeInfo.projectId || 'default-cli-project',
        workspaceName: routeInfo.projectId || 'default-cli-project',
        lastModifiedMs: Date.now() - 60_000,
        lastModifiedLabel: 'Recent',
        status: 'idle',
      });
    }
  });

  const mergedSessions = Array.from(sessionMap.values()).sort(
    (a, b) => b.lastModifiedMs - a.lastModifiedMs
  );

  saveAndBroadcastState({
    devices,
    sessions: mergedSessions,
  });

  ensureActiveConversationOpen();

  return currentState;
}

let lastAutoRedirectMs = 0;

/**
 * Automatically bypasses the Antigravity Web `Remote Conversations` directory page (`/remote`)
 * by jumping directly into the active or most recent conversation as soon as sessions are known.
 */
export function ensureActiveConversationOpen(): void {
  if (!window.location.hostname.includes('antigravity.google.com')) return;
  const routeInfo = parseCurrentAgyRoute();
  // Already inside an active conversation (`c/<cascadeId>`)
  if (routeInfo.cascadeId) return;
  if (currentState.sessions.length === 0) return;
  if (Date.now() - lastAutoRedirectMs < 2500) return;

  const preferred =
    currentState.sessions.find(
      (s) =>
        s.cascadeId === currentState.currentCascadeId &&
        s.deviceUuid !== '__remote_conversations__'
    ) ||
    currentState.sessions.find((s) => s.deviceUuid !== '__remote_conversations__') ||
    currentState.sessions[0];

  if (preferred && preferred.cascadeId) {
    lastAutoRedirectMs = Date.now();
    openUnifiedSession(preferred, preferred.activeTab || 'chat');
  }
}

/**
 * Jumps directly to ANY session on ANY device in 1 tap (solving the "Select Device First" friction).
 * - If already connected to `session.deviceUuid`, sends 0ms in-memory `navigateIframeToChildPath` to `#hubFrame`.
 * - If on a different device (or in Gemini mode), switches to Antigravity and navigates to:
 *   `/r/<deviceUuid>?p=c%2F<cascadeId>%3Fproject%3D<projectId>%26tab%3D<tab>`
 */
export function openUnifiedSession(
  session: Pick<UnifiedRemoteSession, 'deviceUuid' | 'cascadeId' | 'projectId'>,
  tab: 'chat' | 'review' | 'files' | 'terminal' = 'chat'
): void {
  const childPath = `c/${session.cascadeId}?project=${encodeURIComponent(
    session.projectId || 'default-cli-project'
  )}&tab=${tab}`;

  const targetUrl =
    session.deviceUuid === '__remote_conversations__'
      ? `https://antigravity.google.com/remote/c/${encodeURIComponent(session.cascadeId)}`
      : `https://antigravity.google.com/r/${encodeURIComponent(
          session.deviceUuid
        )}?p=${encodeURIComponent(childPath)}`;

  // If currently inside Gemini WebView, ask native host to switch engine & navigate Antigravity WebView
  if (window.location.hostname.includes('gemini.google.com')) {
    const tauriInvoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;

    if (tauriInvoke) {
      void tauriInvoke('navigate_to_remote_session', { targetUrl });
      return;
    }
    const androidBridge = (window as unknown as {
      AndroidBridge?: { navigateToRemoteSession?: (url: string) => void; switchEngine?: (e: string) => void };
    }).AndroidBridge;
    if (androidBridge?.navigateToRemoteSession) {
      androidBridge.navigateToRemoteSession(targetUrl);
      return;
    }
    window.location.assign(targetUrl);
    return;
  }

  // If already on the same Remote Control device in Antigravity WebView, use 0ms in-memory iframe navigation!
  const routeInfo = parseCurrentAgyRoute();
  if (
    routeInfo.surface === 'remote-control' &&
    routeInfo.instanceUuid === session.deviceUuid &&
    capturedRemoteControlComp &&
    typeof capturedRemoteControlComp.navigateIframeToChildPath === 'function'
  ) {
    capturedRemoteControlComp.navigateIframeToChildPath(childPath);
    if (typeof capturedRemoteControlComp.handleUrlChanged === 'function') {
      capturedRemoteControlComp.handleUrlChanged(childPath);
    }
    saveAndBroadcastState({
      currentInstanceUuid: session.deviceUuid,
      currentCascadeId: session.cascadeId,
      currentProjectId: session.projectId,
      currentTab: tab,
    });
    return;
  }

  // If Angular Router is available on RemoteControlComponent, use it for SPA navigation across devices
  if (
    session.deviceUuid !== '__remote_conversations__' &&
    capturedRemoteControlComp?.router &&
    typeof capturedRemoteControlComp.router.navigate === 'function'
  ) {
    void capturedRemoteControlComp.router.navigate(['/r', session.deviceUuid], {
      queryParams: { p: childPath },
    });
    return;
  }

  window.location.assign(targetUrl);
}

/**
 * Scrapes recent Gemini chat threads when running inside gemini.google.com
 * and syncs them into UnifiedAppState so they appear in the unified drawer on both engines!
 */
export function syncGeminiChatsFromDom(): void {
  if (!window.location.hostname.includes('gemini.google.com')) return;

  const threads: GeminiChatThread[] = [];
  const seen = new Set<string>();

  // Target conversation links in Gemini Web structure
  const selectors = [
    'bard-sidenav a[href*="/app/"]',
    'conversations-list a[href*="/app/"]',
    'chat-history-list a[href*="/app/"]',
    '[data-test-id*="conversation"] a[href*="/app/"]',
    'a[data-test-id*="conversation"]',
    'nav a[href*="/app/"]',
  ];

  const links = document.querySelectorAll<HTMLAnchorElement>(selectors.join(', '));
  links.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const match = /\/app\/([a-zA-Z0-9_-]{10,})/.exec(href);
    if (!match) return;
    const id = match[1];
    if (seen.has(id)) return;

    const titleNode =
      a.querySelector<HTMLElement>(
        '.conversation-title, [data-test-id*="title"], [role="button"] span'
      ) || a;
    const rawTitle = (titleNode.textContent || a.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim();

    const candidate: GeminiChatThread = {
      id,
      title: rawTitle.slice(0, 80),
      url: `https://gemini.google.com/app/${id}`,
      updatedAtMs: Date.now() - threads.length * 1000,
    };

    if (!isValidGeminiChatThread(candidate)) return;

    seen.add(id);
    threads.push(candidate);
  });

  // Only broadcast if we actually found valid threads and they differ from current state
  if (threads.length > 0) {
    const currentIds = currentState.geminiChats.map((t) => t.id).join(',');
    const newThreads = threads.slice(0, 20);
    const newIds = newThreads.map((t) => t.id).join(',');
    if (currentIds !== newIds) {
      saveAndBroadcastState({
        activeEngine: 'gemini',
        geminiChats: newThreads,
      });
    }
  }
}

/**
 * Scrapes Google user profile (name, email, avatar URL, tier) from Google Account bar in Gemini or Antigravity
 */
export function syncUserProfileFromDom(): void {
  try {
    let name = '';
    let email = '';
    let avatarUrl = '';
    let tier = '';

    // 1. Check Google OneGoogleBar / Account button
    const accountBtn = document.querySelector<HTMLElement>(
      'a[aria-label*="Google Account"], button[aria-label*="Google Account"], a[aria-label*="Google 账号"], button[aria-label*="Google 账号"], a[aria-label*="Google 帳號"], [data-ogsr-up]'
    );

    if (accountBtn) {
      const label = accountBtn.getAttribute('aria-label') || '';
      const emailMatch = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(label);
      if (emailMatch) {
        email = emailMatch[1];
      }
      const nameMatch = /(?:Google Account|Google 账号|Google 帳號)[：:\s]+([^(\n]+)/i.exec(label);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }

      const img = accountBtn.querySelector<HTMLImageElement>('img[src*="googleusercontent.com"], img');
      if (img?.src) {
        avatarUrl = img.src;
      }
    }

    // 2. Fallback check for any googleusercontent avatar image
    if (!avatarUrl) {
      const avatarImg = document.querySelector<HTMLImageElement>(
        'img[src*="googleusercontent.com/a/"], img[src*="googleusercontent.com/ogw/"]'
      );
      if (avatarImg?.src) {
        avatarUrl = avatarImg.src;
      }
    }

    // 3. Detect Gemini Advanced / Google AI Premium tier
    if (document.querySelector('gemini-advanced-badge, [data-test-id="gemini-advanced"], .advanced-badge')) {
      tier = 'Gemini Advanced';
    } else if (window.location.hostname.includes('antigravity.google.com')) {
      tier = 'Google AI · Dual Engine';
    }

    if (name || email || avatarUrl) {
      const current = getUnifiedState();
      const existing = current.userProfile;
      if (!existing || existing.email !== email || existing.name !== name || existing.avatarUrl !== avatarUrl) {
        saveAndBroadcastState({
          userProfile: {
            name: name || existing?.name || 'Google User',
            email: email || existing?.email || '',
            avatarUrl: avatarUrl || existing?.avatarUrl,
            tier: tier || existing?.tier || 'Google AI · Dual Engine',
          },
        });
      }
    }
  } catch {
    // Non-fatal
  }
}
