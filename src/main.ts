import {
  openClaudeBottomSheet,
  sessionState,
  type SheetDestinationKind,
} from './inject/claude-bottom-sheets';
import { el, sendToNative } from './inject/dom-safe';
import { mountQuickComposerAndImeGuard } from './inject/quick-composer';
import { mountSharedNavigation } from './inject/shared-nav-bar';

const DEMO_SHEETS: Array<{ id: SheetDestinationKind; title: string; subtitle: string }> = [
  {
    id: 'ApprovalDiffDetail',
    title: '① ApprovalDiffDetail',
    subtitle: '全量无截断命令/Diff 审批 + 附言拒绝 (ccr_comment)',
  },
  {
    id: 'PermissionModeSelection',
    title: '② PermissionModeSelection',
    subtitle: '切换 Request Review / Accept Edits / Sandbox / Always Proceed',
  },
  {
    id: 'PlanView',
    title: '③ PlanView & Artifacts',
    subtitle: '专属方案阅读器 + 一键 Proceed 批准执行',
  },
  {
    id: 'DiffView',
    title: '④ DiffView & WorkspaceFile',
    subtitle: '手机窄屏自适应 Unified 单列红绿对比检视器',
  },
  {
    id: 'BackgroundShellOutput',
    title: '⑤ BackgroundShellOutput',
    subtitle: '实时黑底终端流与后台任务监控',
  },
  {
    id: 'CollapsedToolCalls',
    title: '⑥ CollapsedToolCalls',
    subtitle: '连续工具调用折叠胶囊与时间轴详情',
  },
  {
    id: 'ViewThinking',
    title: '⑦ ViewThinking',
    subtitle: '模型推理思考过程独立沉浸式抽屉',
  },
  {
    id: 'TaskList',
    title: '⑧ TaskList & Subagents',
    subtitle: 'Subagents 与 Swarm 协作状态监控',
  },
  {
    id: 'DeviceSessions',
    title: '⑨ DeviceSessions & Google SSO',
    subtitle: 'Workstation 切换与 Google One AI 官方订阅管理',
  },
  {
    id: 'Settings',
    title: '⑩ Settings & Account Center',
    subtitle: 'Google 账号中心、核心引擎偏好、主题与缓存管理',
  },
];

function initHubPage(): void {
  (window as unknown as { openClaudeBottomSheet: typeof openClaudeBottomSheet }).openClaudeBottomSheet =
    openClaudeBottomSheet;
  mountSharedNavigation('antigravity', () => {
    openClaudeBottomSheet('DeviceSessions');
  });
  mountQuickComposerAndImeGuard();

  // Seed sample approval & tool data for local interactive testing
  sessionState.pendingApproval = {
    sessionId: 'session_local_workstation',
    requestId: 'req_demo_001',
    toolName: 'run_command (Terminal Execution)',
    commandOrDiff:
      'bun run build:inject && bun run tauri android build --apk true\n# Working Directory: ./antigravity-app',
    timestamp: Date.now(),
  };

  sessionState.toolCalls = [
    {
      id: 'tc_1',
      name: 'rea inspect-android-method',
      summary: 'CCRPermissionActionReceiver.a (base.apk)',
      detail: 'Extracted 3 actions: CCR_PERMISSION_APPROVE, CCR_PERMISSION_DENY, CCR_PERMISSION_DENY_WITH_COMMENT (ccr_comment)',
      status: 'done',
      timestamp: '14:02:44',
    },
    {
      id: 'tc_2',
      name: 'agy plugin install',
      summary: 'https://github.com/GoogleChrome/modern-web-guidance',
      detail: 'Installed skills: modern-web-guidance, chrome-extensions (v1.0.0)',
      status: 'done',
      timestamp: '13:36:06',
    },
  ];

  const geminiBtn = document.getElementById('btn-launch-gemini');
  const agyBtn = document.getElementById('btn-launch-agy');
  geminiBtn?.addEventListener('click', () =>
    sendToNative({ type: 'SWITCH_ENGINE', engine: 'gemini' })
  );
  agyBtn?.addEventListener('click', () =>
    sendToNative({ type: 'SWITCH_ENGINE', engine: 'antigravity' })
  );

  const grid = document.getElementById('sheet-launcher-grid');
  if (grid) {
    for (const s of DEMO_SHEETS) {
      grid.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'sheet-card-btn',
            onClick: () => openClaudeBottomSheet(s.id),
          },
          el('strong', { text: s.title }),
          el('span', { style: { fontSize: '0.8rem', color: 'var(--color-muted)' }, text: s.subtitle })
        )
      );
    }
  }
}

initHubPage();
