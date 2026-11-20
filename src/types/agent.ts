export type ThemeMode = 'system' | 'light' | 'dark';

export type SessionViewMode = 'unified' | 'by-account' | 'by-device';

export type PermissionMode =
  | 'request-review'
  | 'accept-edits'
  | 'proceed-in-sandbox'
  | 'always-proceed';

export interface AccountSummary {
  id: string;
  label: string;
  email: string;
  authenticated: boolean;
  hasSapisid: boolean;
  cookieCount: number;
  authUser: number;
  enabled: boolean;
  updatedAtMs: number;
}

export interface DeviceInstance {
  accountId: string;
  accountLabel: string;
  uuid: string;
  displayName: string;
  version: string;
  supportsChunking: boolean;
  status: 'RUNNING' | 'IDLE' | 'DISCONNECTED';
  lastActiveMs: number;
}

export interface UnifiedSessionSummary {
  id: string; // `${accountId}::${deviceUuid}::${cascadeId}`
  accountId: string;
  accountLabel: string;
  cascadeId: string;
  title: string;
  snippet: string;
  deviceUuid: string;
  deviceName: string;
  deviceStatus: 'RUNNING' | 'IDLE' | 'DISCONNECTED';
  workspaceName: string;
  lastModifiedMs: number;
  stepCount?: number;
  status: 'running' | 'waiting_approval' | 'idle';
  parentCascadeId?: string | null;
  subagentRole?: string | null;
  subagentType?: string | null;
  nestingDepth?: number;
}

export interface AccountFetchError {
  accountId: string;
  accountLabel: string;
  code: 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'API_ERROR' | string;
  message: string;
}

export interface AllSessionsSnapshot {
  accounts: AccountSummary[];
  devices: DeviceInstance[];
  sessions: UnifiedSessionSummary[];
  accountErrors?: AccountFetchError[];
}

export interface ModelQuotaItem {
  id: string;
  displayName: string;
  description?: string | null;
  remainingFraction?: number | null;
  resetTimeIso?: string | null;
  resetTimeMs?: number | null;
  isDefault: boolean;
  disabled: boolean;
}

export interface AccountQuotaSnapshot {
  accountId: string;
  accountLabel: string;
  email: string;
  planName?: string | null;
  userTier?: string | null;
  availablePromptCredits?: number | null;
  monthlyPromptCredits?: number | null;
  availableFlowCredits?: number | null;
  monthlyFlowCredits?: number | null;
  onlineDevices: number;
  totalDevices: number;
  sourceDeviceName?: string | null;
  models: ModelQuotaItem[];
  errorCode?: string | null;
  errorMessage?: string | null;
  fetchedAtMs: number;
}

export interface QuotaDashboardSnapshot {
  accounts: AccountQuotaSnapshot[];
  fetchedAtMs: number;
}

export type ToolCategory = 'read' | 'search' | 'edit' | 'terminal' | 'browser' | 'mcp' | 'other';

export interface ToolCallDetail {
  id: string;
  stepIndex: number;
  name: string;
  category: ToolCategory;
  summary: string;
  detail: string;
  filePath?: string;
  additions?: number;
  deletions?: number;
  diffContent?: string;
  commandLine?: string;
  shellOutput?: string;
  exitCode?: number;
  status: 'running' | 'done' | 'error' | 'waiting';
  timestampMs?: number;
}

export interface PendingApproval {
  trajectoryId: string;
  stepIndex: number;
  kind: 'runCommand' | 'filePermission' | 'permission' | 'plan';
  toolName: string;
  title: string;
  commandOrDiff: string;
  filePath?: string;
}

export interface MediaAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  base64: string;
}

export interface ModelOption {
  id: string;
  displayName: string;
  description?: string;
  remainingFraction?: number;
  resetTimeMs?: number;
  isDefault?: boolean;
}

export interface AskUserQuestionData {
  id: string;
  stepIndex: number;
  question: string;
  options: string[];
  multiSelect?: boolean;
  answered?: boolean;
  selectedAnswer?: string;
}

export interface TaskChecklistItem {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
}

export type TimelineItem =
  | {
      id: string;
      kind: 'user';
      stepIndex: number;
      text: string;
      attachments?: MediaAttachment[];
      timestampMs?: number;
    }
  | {
      id: string;
      kind: 'question';
      stepIndex: number;
      question: AskUserQuestionData;
    }
  | {
      id: string;
      kind: 'thinking';
      stepIndex: number;
      text: string;
      durationSec?: number;
      isStreaming?: boolean;
    }
  | {
      id: string;
      kind: 'tool';
      stepIndex: number;
      tool: ToolCallDetail;
    }
  | {
      id: string;
      kind: 'plan';
      stepIndex: number;
      title: string;
      path: string;
      markdown: string;
    }
  | {
      id: string;
      kind: 'assistant';
      stepIndex: number;
      markdown: string;
      isStreaming?: boolean;
    }
  | {
      id: string;
      kind: 'error';
      stepIndex: number;
      message: string;
      isQuotaError?: boolean;
      errorCode?: string;
      resetTime?: string;
    };

export type SheetDestination =
  | { kind: 'ApprovalDiffDetail'; approval: PendingApproval }
  | { kind: 'PermissionModeSelection' }
  | { kind: 'PlanView'; title: string; path: string; markdown: string; htmlPreview?: string }
  | { kind: 'ImagePreview'; src: string; title: string }
  | { kind: 'DiffView'; title: string; diff: string; filePath?: string }
  | { kind: 'BackgroundShellOutput'; command: string; output: string; status: string }
  | { kind: 'CollapsedToolCalls'; title: string; tools: ToolCallDetail[] }
  | { kind: 'ViewThinking'; text: string; durationSec?: number }
  | { kind: 'TaskList'; tasks: TaskChecklistItem[] }
  | { kind: 'DeviceSessions' }
  | { kind: 'ModelPicker' }
  | { kind: 'SubagentView'; subagent: UnifiedSessionSummary }
  | { kind: 'QuotaDashboard' }
  | { kind: 'Settings' };

export type AgentStreamEvent =
  | { kind: 'connected'; accountId: string; deviceUuid: string; cascadeId: string }
  | { kind: 'update'; payload: Record<string, unknown> }
  | { kind: 'error'; message: string }
  | { kind: 'closed' };
