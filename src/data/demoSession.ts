import type {
  AccountSummary,
  DeviceInstance,
  PendingApproval,
  TaskChecklistItem,
  TimelineItem,
  UnifiedSessionSummary,
} from '../types/agent';

export const DEMO_ACCOUNTS: AccountSummary[] = [
  {
    id: 'demo-acc-personal',
    label: 'Personal',
    email: 'personal@example.com',
    authenticated: false,
    hasSapisid: false,
    cookieCount: 0,
    authUser: 0,
    enabled: true,
    updatedAtMs: Date.now() - 60_000,
  },
  {
    id: 'demo-acc-work',
    label: 'Work Team',
    email: 'work@example.com',
    authenticated: false,
    hasSapisid: false,
    cookieCount: 0,
    authUser: 0,
    enabled: true,
    updatedAtMs: Date.now() - 120_000,
  },
];

export const DEMO_DEVICES: DeviceInstance[] = [
  {
    accountId: 'demo-acc-personal',
    accountLabel: 'Personal',
    uuid: 'demo-workstation-01',
    displayName: 'Workstation-Mac',
    version: '2.4.0',
    supportsChunking: true,
    status: 'RUNNING',
    lastActiveMs: Date.now() - 12_000,
  },
  {
    accountId: 'demo-acc-work',
    accountLabel: 'Work Team',
    uuid: 'demo-linux-server-02',
    displayName: 'Build-Linux-Box',
    version: '2.4.0',
    supportsChunking: true,
    status: 'IDLE',
    lastActiveMs: Date.now() - 18 * 60_000,
  },
];

export const DEMO_SESSIONS: UnifiedSessionSummary[] = [
  {
    id: 'demo-acc-personal::demo-workstation-01::demo-cascade-01',
    accountId: 'demo-acc-personal',
    accountLabel: 'Personal',
    cascadeId: 'demo-cascade-01',
    title: 'Refactor gRPC-Web Streaming Client',
    snippet: 'Implemented HTTP/2 StreamProxyCommand decoder with Connect framing',
    deviceUuid: 'demo-workstation-01',
    deviceName: 'Workstation-Mac',
    deviceStatus: 'RUNNING',
    workspaceName: 'antigravity-app',
    lastModifiedMs: Date.now() - 25_000,
    status: 'waiting_approval',
  },
  {
    id: 'demo-acc-work::demo-linux-server-02::demo-cascade-02',
    accountId: 'demo-acc-work',
    accountLabel: 'Work Team',
    cascadeId: 'demo-cascade-02',
    title: 'Fix Android Edge-to-Edge Insets',
    snippet: 'Verified WindowCompat insets on Android 16',
    deviceUuid: 'demo-linux-server-02',
    deviceName: 'Build-Linux-Box',
    deviceStatus: 'IDLE',
    workspaceName: 'mobile-sdk',
    lastModifiedMs: Date.now() - 42 * 60_000,
    status: 'idle',
  },
  {
    id: 'demo-acc-personal::demo-workstation-01::demo-cascade-03',
    accountId: 'demo-acc-personal',
    accountLabel: 'Personal',
    cascadeId: 'demo-cascade-03',
    title: 'Multi-Account Cookie Vault Sync',
    snippet: 'Designed antigravity-vault/v1 schema for PC <-> Mobile sync',
    deviceUuid: 'demo-workstation-01',
    deviceName: 'Workstation-Mac',
    deviceStatus: 'RUNNING',
    workspaceName: 'antigravity-app',
    lastModifiedMs: Date.now() - 3 * 3600_000,
    status: 'idle',
  },
];

export const DEMO_TASKS: TaskChecklistItem[] = [
  { id: 't1', label: 'Extract boq-jetski ApiService & LanguageServerService schemas', status: 'done' },
  { id: 't2', label: 'Implement Rust multi-account gRPC-Web & Connect stream framing', status: 'done' },
  { id: 't3', label: 'Build Claude Mobile-style unified + grouped session drawer', status: 'in_progress' },
  { id: 't4', label: 'Sync multi-account Cookie Vault between PC and Mobile', status: 'pending' },
];

export const DEMO_APPROVAL: PendingApproval = {
  trajectoryId: 'demo-traj-01',
  stepIndex: 7,
  kind: 'runCommand',
  toolName: 'Run Command',
  title: 'Allow terminal command?',
  commandOrDiff: 'cd src-tauri && cargo test --lib protocol::wire',
};

export const DEMO_TIMELINE: TimelineItem[] = [
  {
    id: 'u-1',
    kind: 'user',
    stepIndex: 0,
    text: '把 Antigravity Web 的底层 gRPC-Web 协议提取到 Rust，支持多账号/多设备会话融合与分组显示，并做成 Claude Mobile 风格的纯原生界面。',
  },
  {
    id: 'th-1',
    kind: 'thinking',
    stepIndex: 1,
    durationSec: 5,
    text: 'I will fan out ListInstances and SearchConversations concurrently across all enabled Antigravity accounts and online devices in Rust, tag every session with accountId + deviceUuid, and keep one searchable session feed with optional account/device filters in the drawer.',
  },
  {
    id: 'tool-1',
    kind: 'tool',
    stepIndex: 2,
    tool: {
      id: 'tool-1',
      stepIndex: 2,
      name: 'Read File',
      category: 'read',
      summary: 'auth.rs',
      detail: 'Implemented Multi-Account AuthStore with antigravity-vault/v1 export/import.',
      filePath: 'src-tauri/src/auth.rs',
      status: 'done',
    },
  },
  {
    id: 'tool-2',
    kind: 'tool',
    stepIndex: 3,
    tool: {
      id: 'tool-2',
      stepIndex: 3,
      name: 'Grep Search',
      category: 'search',
      summary: 'StreamProxyCommand',
      detail: 'Verified per-account SAPISIDHASH headers for concurrent fan-out.',
      status: 'done',
    },
  },
  {
    id: 'tool-3',
    kind: 'tool',
    stepIndex: 4,
    tool: {
      id: 'tool-3',
      stepIndex: 4,
      name: 'Edit File',
      category: 'edit',
      summary: 'client.rs',
      filePath: 'src-tauri/src/protocol/client.rs',
      additions: 64,
      deletions: 12,
      diffContent: `@@ -220,6 +220,14 @@ impl AntigravityClient {
+  pub async fn list_all_sessions(&self) -> Result<AllSessionsSnapshot, String> {
+    let enabled_accounts = self.auth.enabled_authenticated_accounts();
+    // Fan out across ALL accounts x ALL online devices concurrently
+    let aggregated = join_all(per_account_futs).await;
+  }`,
      detail: 'Added concurrent multi-account x multi-device session aggregation.',
      status: 'done',
    },
  },
  {
    id: 'plan-1',
    kind: 'plan',
    stepIndex: 5,
    title: 'implementation_plan.md',
    path: 'docs/implementation_plan.md',
    markdown: `# Pure-Native Antigravity v2 (Multi-Account)\n\n- **Multi-Account Engine**: Concurrent fan-out across all enabled Google accounts × paired machines\n- **Views**: one Claude-style **session feed**, with account/device filters in the filter panel\n- **Sync Vault**: Versioned \`antigravity-vault/v1\` bundle ready for PC ↔ Mobile cloud sync`,
  },
  {
    id: 'tool-4',
    kind: 'tool',
    stepIndex: 6,
    tool: {
      id: 'tool-4',
      stepIndex: 6,
      name: 'Terminal',
      category: 'terminal',
      summary: 'cargo check',
      commandLine: 'cd src-tauri && cargo check',
      shellOutput: '   Compiling antigravity-app v2.0.0\n    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.32s',
      detail: 'Finished dev profile in 0.32s',
      exitCode: 0,
      status: 'done',
    },
  },
  {
    id: 'asst-1',
    kind: 'assistant',
    stepIndex: 7,
    markdown: `已升级为 **多账号无头原生架构**：\n\n1. **多账号 × 多设备融合**：左上角抽屉使用单一会话流，通过筛选面板按账号或设备过滤，不再切换三种视图。\n2. **账号与 Vault 同步**：右上角 **Settings** 支持管理多个 Antigravity 账号，并通过自建 Bun 云端服务实现 PC ↔ 手机端一键同步。`,
  },
  {
    id: 'q-1',
    kind: 'question',
    stepIndex: 8,
    question: {
      id: 'q-1',
      stepIndex: 8,
      question: '接下来优先发布哪个渠道的 Release 包？',
      options: [
        'GitHub Releases（含增量热更包 + arm64 签名 APK）',
        '仅构建 macOS Apple Silicon 桌面版 (.dmg)',
        '同时构建 Android + macOS + Windows 全平台',
      ],
      multiSelect: false,
    },
  },
];
