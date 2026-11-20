import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AccountSummary,
  AgentStreamEvent,
  AllSessionsSnapshot,
  DeviceInstance,
  QuotaDashboardSnapshot,
} from '../types/agent';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function listAccounts(): Promise<AccountSummary[]> {
  if (!isTauriRuntime()) return [];
  return invoke<AccountSummary[]>('list_accounts');
}

export async function importAccountCookies(params: {
  accountId?: string;
  label?: string;
  email?: string;
  rawInput: string;
  authUser?: number;
}): Promise<AccountSummary> {
  return invoke<AccountSummary>('import_account_cookies', params);
}

export async function toggleAccount(accountId: string, enabled: boolean): Promise<AccountSummary[]> {
  return invoke<AccountSummary[]>('toggle_account', { accountId, enabled });
}

export async function removeAccount(accountId: string): Promise<AccountSummary[]> {
  return invoke<AccountSummary[]>('remove_account', { accountId });
}

export async function exportVaultJson(): Promise<string> {
  return invoke<string>('export_vault_json');
}

export async function importVaultJson(rawJson: string): Promise<AccountSummary[]> {
  return invoke<AccountSummary[]>('import_vault_json', { rawJson });
}

export interface SyncUserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export interface SyncStatusInfo {
  serverUrl: string;
  signedIn: boolean;
  user: SyncUserProfile | null;
  vaultVersion: number;
  lastSyncedMs: number;
}

export async function syncGetStatus(): Promise<SyncStatusInfo> {
  if (!isTauriRuntime()) {
    return {
      serverUrl: 'https://antigravity.yterm.cn',
      signedIn: false,
      user: null,
      vaultVersion: 0,
      lastSyncedMs: 0,
    };
  }
  return invoke<SyncStatusInfo>('sync_get_status');
}

export async function syncSetServerUrl(serverUrl: string): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_set_server_url', { serverUrl });
}

export async function syncLoginGoogleIdToken(idToken: string): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_login_google_id_token', { idToken });
}

export async function syncLoginDevSso(email: string, name?: string): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_login_dev_sso', { email, name });
}

export async function syncStartGoogleOAuth(): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_start_google_oauth');
}

export async function syncCompleteOAuthCallback(callbackUrl: string): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_complete_oauth_callback', { callbackUrl });
}

export async function syncLogout(): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_logout');
}

export async function syncPushVault(): Promise<SyncStatusInfo> {
  return invoke<SyncStatusInfo>('sync_push_vault');
}

export async function syncPullVault(): Promise<[SyncStatusInfo, AccountSummary[]]> {
  return invoke<[SyncStatusInfo, AccountSummary[]]>('sync_pull_vault');
}

export interface ReleaseAssetInfo {
  name: string;
  url: string;
  size: number;
  sha256?: string | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  strategy: 'none' | 'incremental' | 'full';
  notes: string;
  pubDate: string;
  releaseUrl: string;
  targetAsset: ReleaseAssetInfo | null;
  repo: string;
}

export type UpdateDownloadEvent =
  | { kind: 'started'; totalBytes: number; fileName: string }
  | { kind: 'progress'; downloadedBytes: number; totalBytes: number; percent: number }
  | { kind: 'verifying' }
  | { kind: 'ready'; filePath: string; sha256: string; strategy: string }
  | { kind: 'error'; message: string };

export async function checkAppUpdate(repo?: string): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('check_app_update', { repo });
}

export async function downloadAppUpdate(
  asset: ReleaseAssetInfo,
  strategy: string,
  onEvent: (evt: UpdateDownloadEvent) => void
): Promise<string> {
  const channel = new Channel<UpdateDownloadEvent>();
  channel.onmessage = onEvent;
  return invoke<string>('download_app_update', {
    asset,
    strategy,
    onEvent: channel,
  });
}

export async function openGoogleLogin(): Promise<void> {
  return invoke('open_google_login');
}

export async function harvestLoginCookies(params?: {
  accountId?: string;
  label?: string;
  email?: string;
  authUser?: number;
}): Promise<AccountSummary> {
  return invoke<AccountSummary>('harvest_login_cookies', params || {});
}

export async function listInstances(accountId?: string): Promise<DeviceInstance[]> {
  return invoke<DeviceInstance[]>('list_instances', { accountId });
}

export async function listAllSessions(): Promise<AllSessionsSnapshot> {
  return invoke<AllSessionsSnapshot>('list_all_sessions');
}

export async function getTrajectorySteps(
  accountId: string,
  deviceUuid: string,
  cascadeId: string,
  stepOffset = 0
): Promise<{ steps?: unknown[] }> {
  return invoke<{ steps?: unknown[] }>('get_trajectory_steps', {
    accountId,
    deviceUuid,
    cascadeId,
    stepOffset,
  });
}

export async function startCascade(
  accountId: string,
  deviceUuid: string,
  workspaceUri?: string,
  projectId?: string
): Promise<{ cascadeId?: string }> {
  return invoke<{ cascadeId?: string }>('start_cascade', {
    accountId,
    deviceUuid,
    workspaceUri,
    projectId,
  });
}

export async function sendUserMessage(
  accountId: string,
  deviceUuid: string,
  cascadeId: string,
  text: string,
  model?: string,
  media?: Array<{ mimeType: string; inlineData: string }>
): Promise<unknown> {
  return invoke('send_user_message', {
    accountId,
    deviceUuid,
    cascadeId,
    text,
    model,
    media,
  });
}

export async function getUserStatus(accountId: string, deviceUuid: string): Promise<unknown> {
  return invoke('get_user_status', { accountId, deviceUuid });
}

export async function handleUserInteraction(
  accountId: string,
  deviceUuid: string,
  cascadeId: string,
  interaction: Record<string, unknown>
): Promise<unknown> {
  return invoke('handle_user_interaction', {
    accountId,
    deviceUuid,
    cascadeId,
    interaction,
  });
}

export async function cancelInvocation(
  accountId: string,
  deviceUuid: string,
  cascadeId: string
): Promise<unknown> {
  return invoke('cancel_invocation', { accountId, deviceUuid, cascadeId });
}

export async function getModelConfigs(accountId: string, deviceUuid: string): Promise<unknown> {
  return invoke('get_model_configs', { accountId, deviceUuid });
}

export async function getAllAccountsQuota(): Promise<QuotaDashboardSnapshot> {
  return invoke<QuotaDashboardSnapshot>('get_all_accounts_quota');
}

export async function rotateAccountCookies(accountId?: string): Promise<boolean> {
  return invoke<boolean>('rotate_account_cookies', { accountId });
}

export async function streamAgentState(
  streamId: string,
  accountId: string,
  deviceUuid: string,
  cascadeId: string,
  onEvent: (evt: AgentStreamEvent) => void
): Promise<void> {
  const channel = new Channel<AgentStreamEvent>();
  channel.onmessage = onEvent;
  return invoke('stream_agent_state', {
    streamId,
    accountId,
    deviceUuid,
    cascadeId,
    onEvent: channel,
  });
}

export async function stopAgentStream(streamId: string): Promise<void> {
  return invoke('stop_agent_stream', { streamId });
}
