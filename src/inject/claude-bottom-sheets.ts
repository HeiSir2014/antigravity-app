import {
  adoptStyleSheet,
  clearChildren,
  el,
  getShowSubtabs,
  getUnifiedFontSize,
  getUnifiedTopbarHeight,
  sendToNative,
  setShowSubtabs,
  setUnifiedFontSize,
  setUnifiedTopbarHeight,
  type UnifiedFontSize,
  type UnifiedTopbarHeight,
} from './dom-safe';
import { createCookieImportCard } from './google-cookie-helper';
import {
  getUnifiedState,
  openUnifiedSession,
  pullStateFromNativeHost,
  refreshAllMultiDeviceSessions,
} from './multi-device-aggregator';

export type SheetDestinationKind =
  | 'ApprovalDiffDetail'
  | 'PermissionModeSelection'
  | 'PlanView'
  | 'DiffView'
  | 'BackgroundShellOutput'
  | 'CollapsedToolCalls'
  | 'ViewThinking'
  | 'TaskList'
  | 'DeviceSessions'
  | 'Settings';

export type StickyPermissionMode =
  | 'request-review'
  | 'accept-edits'
  | 'proceed-in-sandbox'
  | 'always-proceed';

export interface ApprovalRequestData {
  sessionId: string;
  requestId: string;
  toolName: string;
  commandOrDiff: string;
  approveBtn?: HTMLElement | null;
  denyBtn?: HTMLElement | null;
  timestamp: number;
}

export interface ToolCallItem {
  id: string;
  name: string;
  summary: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  timestamp: string;
}

export interface CapturedSessionState {
  stickyPermissionMode: StickyPermissionMode;
  pendingApproval: ApprovalRequestData | null;
  planTitle: string;
  planContent: string;
  latestDiffTitle: string;
  latestDiffContent: string;
  shellOutput: string[];
  toolCalls: ToolCallItem[];
  thinkingBlocks: string[];
  subagents: Array<{ name: string; role: string; status: string }>;
  activeModel: string;
}

const STORAGE_PERM_KEY = '__agy_sticky_permission_mode__';

function loadStickyPermissionMode(): StickyPermissionMode {
  try {
    const saved = localStorage.getItem(STORAGE_PERM_KEY) as StickyPermissionMode | null;
    if (
      saved === 'request-review' ||
      saved === 'accept-edits' ||
      saved === 'proceed-in-sandbox' ||
      saved === 'always-proceed'
    ) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'request-review';
}

export const sessionState: CapturedSessionState = {
  stickyPermissionMode: loadStickyPermissionMode(),
  pendingApproval: null,
  planTitle: 'implementation_plan.md',
  planContent: '',
  latestDiffTitle: 'Workspace Changes',
  latestDiffContent: '',
  shellOutput: [],
  toolCalls: [],
  thinkingBlocks: [],
  subagents: [
    { name: 'main-agent', role: 'Coordinator (Antigravity Remote)', status: 'working' },
  ],
  activeModel: 'Gemini 4 Argon',
};

const SHEET_CSS = `
/* Modern Web Guidance: dialog scroll containment & light-dark color tokens */
:root {
  --agy-surface-light: #ffffff;
  --agy-surface-dark: #13151a;
  --agy-surface-elev-light: #f3f5f8;
  --agy-surface-elev-dark: #1d2028;
  --agy-text-light: #111827;
  --agy-text-dark: #f3f4f6;
  --agy-muted-light: #5f6672;
  --agy-muted-dark: #9ca3af;
  --agy-border-light: rgb(0 0 0 / 0.1);
  --agy-border-dark: rgb(255 255 255 / 0.12);
  --agy-accent-light: #1a73e8;
  --agy-accent-dark: #7cacf8;
  --agy-danger-light: #d93025;
  --agy-danger-dark: #f28b82;
  --agy-success-light: #188038;
  --agy-success-dark: #81c995;

  --agy-surface: var(--agy-surface-light);
  --agy-surface-elev: var(--agy-surface-elev-light);
  --agy-text: var(--agy-text-light);
  --agy-muted: var(--agy-muted-light);
  --agy-border: var(--agy-border-light);
  --agy-accent: var(--agy-accent-light);
  --agy-danger: var(--agy-danger-light);
  --agy-success: var(--agy-success-light);

  @media (prefers-color-scheme: dark) {
    --agy-surface: var(--agy-surface-dark);
    --agy-surface-elev: var(--agy-surface-elev-dark);
    --agy-text: var(--agy-text-dark);
    --agy-muted: var(--agy-muted-dark);
    --agy-border: var(--agy-border-dark);
    --agy-accent: var(--agy-accent-dark);
    --agy-danger: var(--agy-danger-dark);
    --agy-success: var(--agy-success-dark);
  }

  @supports (color: light-dark(white, black)) {
    --agy-surface: light-dark(var(--agy-surface-light), var(--agy-surface-dark));
    --agy-surface-elev: light-dark(var(--agy-surface-elev-light), var(--agy-surface-elev-dark));
    --agy-text: light-dark(var(--agy-text-light), var(--agy-text-dark));
    --agy-muted: light-dark(var(--agy-muted-light), var(--agy-muted-dark));
    --agy-border: light-dark(var(--agy-border-light), var(--agy-border-dark));
    --agy-accent: light-dark(var(--agy-accent-light), var(--agy-accent-dark));
    --agy-danger: light-dark(var(--agy-danger-light), var(--agy-danger-dark));
    --agy-success: light-dark(var(--agy-success-light), var(--agy-success-dark));
  }

  color-scheme: light dark;
}

html[data-agy-unified-theme="light"] {
  color-scheme: light;
  --agy-surface: var(--agy-surface-light);
  --agy-surface-elev: var(--agy-surface-elev-light);
  --agy-text: var(--agy-text-light);
  --agy-muted: var(--agy-muted-light);
  --agy-border: var(--agy-border-light);
  --agy-accent: var(--agy-accent-light);
  --agy-danger: var(--agy-danger-light);
  --agy-success: var(--agy-success-light);
}

html[data-agy-unified-theme="dark"] {
  color-scheme: dark;
  --agy-surface: var(--agy-surface-dark);
  --agy-surface-elev: var(--agy-surface-elev-dark);
  --agy-text: var(--agy-text-dark);
  --agy-muted: var(--agy-muted-dark);
  --agy-border: var(--agy-border-dark);
  --agy-accent: var(--agy-accent-dark);
  --agy-danger: var(--agy-danger-dark);
  --agy-success: var(--agy-success-dark);
}

dialog.agy-bottom-sheet:modal {
  overscroll-behavior: contain;
}

dialog.agy-bottom-sheet::backdrop {
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(4px);
}

dialog.agy-bottom-sheet {
  inset: auto 0 0 0;
  width: 100%;
  max-width: 48rem;
  max-height: 86dvh;
  margin: auto auto 0 auto;
  padding: 0;
  border: 1px solid var(--agy-border);
  border-bottom: 0;
  border-radius: 20px 20px 0 0;
  background: var(--agy-surface);
  color: var(--agy-text);
  box-shadow: 0 -12px 40px rgb(0 0 0 / 0.35);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Modern Web Guidance: Desktop PC adaptive centered dialog layout */
@media (min-width: 768px) and (pointer: fine), (min-width: 1024px) {
  dialog.agy-bottom-sheet {
    inset: 0 !important;
    margin: auto !important;
    width: min(780px, 92vw) !important;
    max-height: 84vh !important;
    border-radius: 16px !important;
    border: 1px solid var(--agy-border) !important;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45) !important;
    transform: none !important;
  }

  .agy-sheet-handle-bar {
    display: none !important;
  }

  @media (prefers-reduced-motion: no-preference) {
    dialog.agy-bottom-sheet[open] {
      animation: agy-desktop-modal-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both !important;
    }
  }

  @keyframes agy-desktop-modal-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
}

html[data-agy-form-factor="desktop"] dialog.agy-bottom-sheet {
  inset: 0 !important;
  margin: auto !important;
  width: min(780px, 92vw) !important;
  max-height: 84vh !important;
  border-radius: 16px !important;
  border: 1px solid var(--agy-border) !important;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45) !important;
  transform: none !important;
}

html[data-agy-form-factor="desktop"] .agy-sheet-handle-bar {
  display: none !important;
}

.agy-sheet-body {
  scrollbar-width: thin;
  scrollbar-color: var(--agy-border) transparent;
}

.agy-sheet-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.agy-sheet-body::-webkit-scrollbar-thumb {
  background: var(--agy-border);
  border-radius: 999px;
}

dialog.agy-bottom-sheet[open] {
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: no-preference) {
  dialog.agy-bottom-sheet[open] {
    animation: agy-sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes agy-sheet-up {
  from {
    translate: 0 100%;
  }
}

.agy-sheet-handle-bar {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}

.agy-sheet-pill {
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: var(--agy-muted);
  opacity: 0.45;
}

.agy-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px 12px;
  border-bottom: 1px solid var(--agy-border);
}

.agy-sheet-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
  text-wrap: balance;
}

.agy-sheet-body {
  padding: 16px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agy-sheet-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px max(14px, env(safe-area-inset-bottom, 14px));
  border-top: 1px solid var(--agy-border);
  background: var(--agy-surface-elev);
}

.agy-btn {
  min-block-size: var(--target-size, 44px);
  min-inline-size: var(--target-size, 44px);
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid var(--agy-border);
  background: var(--agy-surface);
  color: var(--agy-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: box-shadow 150ms ease-out, scale 150ms ease-out;
}

.agy-btn:hover {
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
}

.agy-btn:active {
  scale: 0.97;
}

.agy-btn:focus-visible {
  outline: 2px solid CanvasText;
  outline-offset: 3px;
}

.agy-btn-primary {
  background: var(--agy-accent);
  color: #fff;
  border-color: transparent;
  flex: 1 1 auto;
}

@media (prefers-color-scheme: dark) {
  .agy-btn-primary {
    color: #081226;
  }
}

.agy-btn-danger {
  background: rgb(217 48 37 / 0.14);
  color: var(--agy-danger);
  border-color: var(--agy-danger);
}

.agy-btn-success {
  background: var(--agy-success);
  color: #071f10;
  border-color: transparent;
  flex: 1 1 auto;
}

.agy-code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  background: #0d1117;
  color: #e6edf3;
  padding: 12px 14px;
  border-radius: 12px;
  overflow-x: auto;
  white-space: pre;
  border: 1px solid rgb(255 255 255 / 0.12);
}

.agy-code-box.is-wrapped {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agy-diff-add {
  background: rgb(46 160 67 / 0.2);
  color: #7ee787;
  display: block;
  padding: 1px 6px;
}

.agy-diff-del {
  background: rgb(248 81 73 / 0.2);
  color: #ffa198;
  display: block;
  padding: 1px 6px;
}

.agy-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 650;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
}

.agy-badge-danger {
  background: rgb(217 48 37 / 0.18);
  color: var(--agy-danger);
  border-color: var(--agy-danger);
}

.agy-card-item {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agy-sheet-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 18px 0;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}

.agy-sheet-tab {
  position: relative;
  flex: none;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--agy-muted);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  scroll-snap-align: start;
}

.agy-sheet-tab[aria-selected="true"] {
  color: var(--agy-accent);
}

.agy-sheet-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  border-block-end: 3px solid var(--agy-accent);
}

.agy-comment-input {
  width: 100%;
  min-block-size: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--agy-border);
  background: var(--agy-surface);
  color: var(--agy-text);
  font-size: 0.9rem;
  box-sizing: border-box;
}

/* Inset Grouped Settings & Account Center (Claude / Apple Grade) */
.agy-settings-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

.agy-settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agy-settings-section-title {
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--agy-muted);
  padding: 0 4px;
}

.agy-settings-group {
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.agy-settings-row {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-decoration: none;
  background: transparent;
  border: 0;
  color: var(--agy-text);
  font-family: inherit;
  position: relative;
  box-sizing: border-box;
}

.agy-settings-row + .agy-settings-row::before {
  content: "";
  position: absolute;
  top: 0;
  left: 54px;
  right: 0;
  height: 1px;
  background: var(--agy-border);
  opacity: 0.6;
}

.agy-settings-row.agy-interactive {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.agy-settings-row.agy-interactive:active {
  background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
}

.agy-settings-row-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
}

.agy-settings-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.agy-settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.agy-settings-row-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--agy-text);
  line-height: 1.3;
}

.agy-settings-row-desc {
  font-size: 0.74rem;
  color: var(--agy-muted);
  line-height: 1.25;
}

.agy-settings-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.agy-settings-row-value {
  font-size: 0.82rem;
  color: var(--agy-muted);
  font-weight: 500;
}

.agy-settings-chevron {
  color: var(--agy-muted);
  font-size: 1.1rem;
  opacity: 0.55;
  margin-left: 2px;
  line-height: 1;
}

.agy-settings-segmented {
  display: flex;
  background: var(--agy-surface);
  border: 1px solid var(--agy-border);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}

.agy-settings-segment-btn {
  padding: 5px 12px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--agy-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  white-space: nowrap;
  font-family: inherit;
}

.agy-settings-segment-btn[aria-checked="true"] {
  background: var(--agy-surface-elev);
  color: var(--agy-accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.agy-account-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  border-radius: 16px;
}

.agy-account-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(66, 133, 244, 0.25);
  border: 2px solid rgba(66, 133, 244, 0.5);
}

.agy-account-avatar-placeholder {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4285f4 0%, #a855f7 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(66, 133, 244, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.2);
}
`;

let sheetDialog: HTMLDialogElement | null = null;
let currentDestination: SheetDestinationKind = 'ApprovalDiffDetail';

function isHighRiskCommand(text: string): boolean {
  return /\b(rm\s+-rf|sudo\s+|git\s+push\s+--force|git\s+reset\s+--hard|chmod\s+777|mkfs|dd\s+if=)\b/i.test(
    text
  );
}

/**
 * Helper to inject text into the active Antigravity / Gemini chat composer and optionally submit.
 */
export function sendTextToPageComposer(text: string, autoSubmit = false): boolean {
  const selectors = [
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"]',
  ];

  for (const sel of selectors) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const target = nodes.find(
      (n) => !n.closest('dialog.agy-bottom-sheet') && n.offsetParent !== null
    );
    if (!target) continue;

    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(target, text);
      } else {
        target.value = text;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      target.textContent = text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }

    if (autoSubmit) {
      setTimeout(() => {
        const sendBtn = Array.from(document.querySelectorAll<HTMLElement>('button')).find(
          (b) =>
            !b.closest('dialog.agy-bottom-sheet') &&
            /send|submit|发送|run/i.test(
              `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`
            )
        );
        if (sendBtn) {
          sendBtn.click();
        } else {
          target.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
          );
        }
      }, 80);
    }
    return true;
  }

  // If we are on /r/:uuid outer host frame, forward composer text into #hubFrame guest iframe!
  const hubFrame = document.querySelector<HTMLIFrameElement>(
    'iframe[src*="antigravity.static.usercontent.goog"], ga-remote-control iframe'
  );
  if (hubFrame?.contentWindow) {
    try {
      const targetOrigin = new URL(hubFrame.src).origin;
      hubFrame.contentWindow.postMessage(
        {
          type: 'AGY_GUEST_COMMAND',
          action: 'INSERT_COMPOSER',
          text,
          autoSubmit,
        },
        targetOrigin
      );
      return true;
    } catch {
      // Ignore
    }
  }

  return false;
}

/**
 * Executes an approval decision (from either the in-app ApprovalDiffDetail sheet
 * or the Android Notification CCRPermissionActionReceiver).
 */
export function executePermissionDecision(
  decision: 'APPROVE' | 'DENY' | 'DENY_WITH_COMMENT',
  comment?: string
): void {
  const pending = sessionState.pendingApproval;
  sendToNative({
    type: 'PERMISSION_DECISION',
    decision,
    comment,
    requestId: pending?.requestId ?? 'latest',
  });

  if (decision === 'APPROVE') {
    if (pending?.approveBtn) {
      pending.approveBtn.click();
    } else {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button')).find(
        (b) =>
          !b.closest('dialog.agy-bottom-sheet') &&
          /\b(approve|allow|proceed|accept|run|confirm|批准|允许|继续)\b/i.test(
            `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`
          )
      );
      btn?.click();
    }
    sessionState.pendingApproval = null;
  } else {
    if (pending?.denyBtn) {
      pending.denyBtn.click();
    } else {
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button')).find(
        (b) =>
          !b.closest('dialog.agy-bottom-sheet') &&
          /\b(deny|reject|cancel|decline|拒绝|取消)\b/i.test(
            `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`
          )
      );
      btn?.click();
    }
    sessionState.pendingApproval = null;

    if (decision === 'DENY_WITH_COMMENT' && comment && comment.trim().length > 0) {
      sendTextToPageComposer(`[Rejected Tool Action] 请按以下要求调整：${comment.trim()}`, true);
    }
  }

  // Also forward decision into #hubFrame guest iframe when on /r/:uuid
  const hubFrame = document.querySelector<HTMLIFrameElement>(
    'iframe[src*="antigravity.static.usercontent.goog"], ga-remote-control iframe'
  );
  if (hubFrame?.contentWindow) {
    try {
      const targetOrigin = new URL(hubFrame.src).origin;
      hubFrame.contentWindow.postMessage(
        {
          type: 'AGY_GUEST_COMMAND',
          action: 'PERMISSION_DECISION',
          decision,
          comment,
        },
        targetOrigin
      );
    } catch {
      // Ignore
    }
  }

  if (sheetDialog?.open && currentDestination === 'ApprovalDiffDetail') {
    sheetDialog.close('decision');
  }
}

function attachLightDismissFallback(dialog: HTMLDialogElement): void {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e)) dialog.close();
    });
  }
}

function ensureSheetDialog(): HTMLDialogElement {
  adoptStyleSheet('agy-bottom-sheets', SHEET_CSS);

  if (sheetDialog && document.body.contains(sheetDialog)) {
    return sheetDialog;
  }

  // Modern Web Guidance `dialog` rule 1: native <dialog> opened via showModal(),
  // no redundant role="dialog" or aria-modal, closedby="any" with pointer fallback.
  const dlg = el('dialog', {
    className: 'agy-bottom-sheet',
    id: 'agy-claude-bottom-sheet',
    aria: { labelledby: 'agy-sheet-heading' },
    attrs: { closedby: 'any' },
  });

  dlg.addEventListener('close', () => {
    dlg.returnValue = '';
  });

  attachLightDismissFallback(dlg);
  document.body.appendChild(dlg);
  sheetDialog = dlg;
  return dlg;
}

const SHEET_TABS: Array<{ id: SheetDestinationKind; label: string }> = [
  { id: 'ApprovalDiffDetail', label: '🛡️ 审批 (Approval)' },
  { id: 'PermissionModeSelection', label: '⚙️ 权限模式' },
  { id: 'PlanView', label: '📋 计划 (Plan)' },
  { id: 'DiffView', label: '🔍 代码 Diff' },
  { id: 'BackgroundShellOutput', label: '💻 终端 & 任务' },
  { id: 'CollapsedToolCalls', label: '🛠️ 工具时间轴' },
  { id: 'ViewThinking', label: '🧠 思考链' },
  { id: 'TaskList', label: '🤖 子智能体' },
  { id: 'DeviceSessions', label: '🖥️ 设备 & 账号' },
];

export function openClaudeBottomSheet(destination: SheetDestinationKind): void {
  currentDestination = destination;
  const dlg = ensureSheetDialog();
  renderSheetContents(dlg, destination);
  if (!dlg.open) {
    dlg.showModal();
  }
}

function renderSheetContents(dlg: HTMLDialogElement, destination: SheetDestinationKind): void {
  clearChildren(dlg);

  const handleBar = el('div', { className: 'agy-sheet-handle-bar' }, el('div', { className: 'agy-sheet-pill' }));

  const tabBar = el(
    'div',
    {
      className: 'agy-sheet-tabs',
      attrs: { focusgroup: 'tablist nomemory' },
      aria: { label: 'Claude Code Remote Bottom Sheets' },
    },
    ...SHEET_TABS.map((t) =>
      el(
        'button',
        {
          type: 'button',
          className: 'agy-sheet-tab',
          role: 'tab',
          aria: { selected: String(t.id === destination) },
          attrs: t.id === destination ? { focusgroupstart: '' } : {},
          text: t.label,
          onClick: () => renderSheetContents(dlg, t.id),
        }
      )
    )
  );

  const titleMap: Record<SheetDestinationKind, string> = {
    ApprovalDiffDetail: '权限审批与命令详情 (ApprovalDiffDetail)',
    PermissionModeSelection: '会话权限策略 (PermissionModeSelection)',
    PlanView: '实施方案与构件阅读器 (PlanView & Artifacts)',
    DiffView: '代码变更单列检视器 (DiffView & WorkspaceFile)',
    BackgroundShellOutput: '实时终端流与后台任务 (BackgroundShellOutput)',
    CollapsedToolCalls: '工具调用时间轴 (CollapsedToolCalls)',
    ViewThinking: '模型推理思考链 (ViewThinking)',
    TaskList: '子智能体与协作状态 (Subagents & Swarm)',
    DeviceSessions: '⚡ 远程工作台与会话',
    Settings: '⚙️ 应用设置与账号中心',
  };

  const closeBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-btn',
      aria: { label: '关闭面板' },
      text: '✕',
      onClick: () => dlg.close('cancel'),
    }
  );

  const body = el('div', { className: 'agy-sheet-body' });
  const footer = el('div', { className: 'agy-sheet-footer' });

  // Settings gets a dedicated modern clean header & skips the 9-tab inspection bar
  if (destination === 'Settings') {
    const headerTitle = el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } },
      el('h2', {
        className: 'agy-sheet-title',
        id: 'agy-sheet-heading',
        style: { fontSize: '1.16rem', fontWeight: '750', letterSpacing: '-0.02em' },
        text: '设置与账号',
      }),
      el('span', {
        className: 'agy-badge',
        style: {
          background: 'light-dark(rgba(26, 115, 232, 0.1), rgba(124, 172, 248, 0.16))',
          color: 'var(--agy-accent)',
          fontWeight: '650',
          fontSize: '0.72rem',
          padding: '2px 8px',
        },
        text: 'v0.1.0',
      })
    );

    const setCloseBtn = el(
      'button',
      {
        type: 'button',
        className: 'agy-btn',
        style: {
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0',
          fontSize: '15px',
          background: 'var(--agy-surface-elev)',
          border: '1px solid var(--agy-border)',
          color: 'var(--agy-muted)',
          cursor: 'pointer',
          flexShrink: '0',
        },
        aria: { label: '关闭设置' },
        text: '✕',
        onClick: () => dlg.close('cancel'),
      }
    );

    const setHeader = el('div', { className: 'agy-sheet-header' }, headerTitle, setCloseBtn);
    populateSettingsSheet(body, footer, dlg);
    dlg.append(handleBar, setHeader, body, footer);
    return;
  }

  // DeviceSessions gets a dedicated clean header & skips the 9-tab inspection bar
  if (destination === 'DeviceSessions') {
    const unified = getUnifiedState();
    const onlineCount = unified.devices.filter((d) => d.status === 'RUNNING').length;
    const headerTitle = el(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } },
      el('h2', { className: 'agy-sheet-title', id: 'agy-sheet-heading', text: '⚡ 远程工作台与会话' }),
      el('span', {
        className: 'agy-badge',
        style: {
          background: 'light-dark(rgba(26, 115, 232, 0.1), rgba(124, 172, 248, 0.16))',
          color: 'var(--agy-accent)',
          fontWeight: '650',
          fontSize: '0.75rem',
        },
        text: `${onlineCount} 在线 · ${unified.sessions.length} 个会话`,
      })
    );

    const devHeader = el('div', { className: 'agy-sheet-header' }, headerTitle, closeBtn);
    populateDeviceSessionsSheet(body, footer, dlg);
    dlg.append(handleBar, devHeader, body, footer);
    return;
  }

  const header = el(
    'div',
    { className: 'agy-sheet-header' },
    el('h2', { className: 'agy-sheet-title', id: 'agy-sheet-heading', text: titleMap[destination] }),
    closeBtn
  );

  switch (destination) {
    case 'ApprovalDiffDetail':
      populateApprovalSheet(body, footer);
      break;
    case 'PermissionModeSelection':
      populatePermissionModeSheet(body, footer, dlg);
      break;
    case 'PlanView':
      populatePlanSheet(body, footer, dlg);
      break;
    case 'DiffView':
      populateDiffSheet(body, footer);
      break;
    case 'BackgroundShellOutput':
      populateShellSheet(body, footer);
      break;
    case 'CollapsedToolCalls':
      populateToolCallsSheet(body, footer);
      break;
    case 'ViewThinking':
      populateThinkingSheet(body, footer);
      break;
    case 'TaskList':
      populateTaskListSheet(body, footer);
      break;
  }

  dlg.append(handleBar, tabBar, header, body, footer);
}

function populateApprovalSheet(body: HTMLElement, footer: HTMLElement): void {
  const pending = sessionState.pendingApproval;
  const cmdText =
    pending?.commandOrDiff ||
    '当前无阻塞中的高危审批请求。\n当远端 Agent 请求执行终端命令或修改受保护文件时，此抽屉会自动弹出完整（无 100 字符截断）的命令与 Diff 预览。';
  const highRisk = isHighRiskCommand(cmdText);

  const metaRow = el(
    'div',
    { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    el('span', {
      className: 'agy-badge',
      text: `🛠️ 工具: ${pending?.toolName ?? 'Terminal / File Action'}`,
    }),
    el('span', {
      className: 'agy-badge',
      text: `🔒 当前模式: ${sessionState.stickyPermissionMode}`,
    }),
    highRisk
      ? el('span', {
          className: 'agy-badge agy-badge-danger',
          text: '⚠️ 检测到高危命令特征 (rm/sudo/force)',
        })
      : null
  );

  let wrapped = true;
  const codeBox = el('pre', {
    className: 'agy-code-box is-wrapped',
    text: cmdText,
  });

  const wrapToggle = el('button', {
    type: 'button',
    className: 'agy-btn',
    text: '⇄ 切换折行 / 横向滚动',
    onClick: () => {
      wrapped = !wrapped;
      codeBox.classList.toggle('is-wrapped', wrapped);
    },
  });

  // Inline comment box matching Claude's CCR_PERMISSION_DENY_WITH_COMMENT (`ccr_comment`)
  const commentInput = el('input', {
    type: 'text',
    className: 'agy-comment-input',
    placeholder: '附言拒绝 (ccr_comment)：告诉 Agent 为什么拒绝或如何修改...',
    aria: { label: '拒绝并附言指导 Agent' },
  }) as HTMLInputElement;

  body.append(metaRow, wrapToggle, codeBox, commentInput);

  const approveBtn = el('button', {
    type: 'button',
    className: 'agy-btn agy-btn-success',
    autofocus: !highRisk,
    text: '✅ 批准本次 (Approve)',
    onClick: () => executePermissionDecision('APPROVE'),
  });

  const stickyApproveBtn = el('button', {
    type: 'button',
    className: 'agy-btn agy-btn-primary',
    text: '⚡ 开启自动放行 (Accept Edits)',
    onClick: () => {
      sessionState.stickyPermissionMode = 'accept-edits';
      try {
        localStorage.setItem(STORAGE_PERM_KEY, 'accept-edits');
      } catch {
        // ignore
      }
      executePermissionDecision('APPROVE');
    },
  });

  const denyWithCommentBtn = el('button', {
    type: 'button',
    className: 'agy-btn agy-btn-danger',
    autofocus: highRisk,
    text: '💬 拒绝并发送附言',
    onClick: () => {
      const c = commentInput.value.trim();
      if (c.length > 0) {
        executePermissionDecision('DENY_WITH_COMMENT', c);
      } else {
        executePermissionDecision('DENY');
      }
    },
  });

  footer.append(approveBtn, stickyApproveBtn, denyWithCommentBtn);
}

function populatePermissionModeSheet(
  body: HTMLElement,
  footer: HTMLElement,
  dlg: HTMLDialogElement
): void {
  const modes: Array<{ id: StickyPermissionMode; title: string; desc: string }> = [
    {
      id: 'request-review',
      title: '🛡️ Request Review（默认逐项审批）',
      desc: 'Agent 执行终端命令或外部写入前弹出底部抽屉与锁屏通知，由你确认。',
    },
    {
      id: 'accept-edits',
      title: '✍️ Accept Safe Edits（对标 claude --permission-mode acceptEdits）',
      desc: '自动放行常规代码文件编辑与安全读取，仅拦截高危命令（如 rm -rf、git push）。',
    },
    {
      id: 'proceed-in-sandbox',
      title: '📦 Proceed in Sandbox（终端沙箱内自动放行）',
      desc: '在 Antigravity 隔离沙箱环境内自动批准命令执行，兼顾效率与边界安全。',
    },
    {
      id: 'always-proceed',
      title: '🚀 Always Proceed（全自动无人值守模式 /goal）',
      desc: '自动点击所有常规审批弹窗，适合在手机端挂机运行长耗时任务。',
    },
  ];

  for (const m of modes) {
    const active = sessionState.stickyPermissionMode === m.id;
    const card = el(
      'div',
      {
        className: 'agy-card-item',
        style: {
          borderColor: active ? 'var(--agy-accent)' : 'var(--agy-border)',
          cursor: 'pointer',
        },
        onClick: () => {
          sessionState.stickyPermissionMode = m.id;
          try {
            localStorage.setItem(STORAGE_PERM_KEY, m.id);
          } catch {
            // ignore
          }
          renderSheetContents(dlg, 'PermissionModeSelection');
        },
      },
      el(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', fontWeight: '650' } },
        el('span', { text: m.title }),
        el('span', { text: active ? '✅ 当前生效' : '点击启用' })
      ),
      el('div', { style: { fontSize: '0.83rem', color: 'var(--agy-muted)' }, text: m.desc })
    );
    body.appendChild(card);
  }

  footer.appendChild(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '完成设置',
      onClick: () => dlg.close(),
    })
  );
}

function populatePlanSheet(
  body: HTMLElement,
  footer: HTMLElement,
  dlg: HTMLDialogElement
): void {
  const content =
    sessionState.planContent ||
    extractLatestArtifactOrPlanFromDom() ||
    '暂未在当前视图捕获到 Plan / Artifact 文档。\n你可以点击下方「发送 /plan 指令」让 Antigravity 生成结构化实施方案。';

  body.append(
    el('div', {
      className: 'agy-badge',
      text: `📄 ${sessionState.planTitle}`,
    }),
    el('pre', {
      className: 'agy-code-box is-wrapped',
      text: content,
    })
  );

  footer.append(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-success',
      text: '✅ Proceed (批准方案并开始执行)',
      onClick: () => {
        executePermissionDecision('APPROVE');
        sendTextToPageComposer('Proceed with the plan.', true);
        dlg.close();
      },
    }),
    el('button', {
      type: 'button',
      className: 'agy-btn',
      text: '📐 触发 /plan',
      onClick: () => {
        sendTextToPageComposer('/plan ', false);
        dlg.close();
      },
    })
  );
}

function populateDiffSheet(body: HTMLElement, footer: HTMLElement): void {
  const rawDiff =
    sessionState.latestDiffContent ||
    extractLatestCodeOrDiffFromDom() ||
    '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,4 +1,6 @@\n // 点击页面任意代码块或 Diff 区域即可在此全屏单列检视\n-const legacyMode = true;\n+const claudeBottomSheetMode = true;\n+const sharedGoogleAuth = true;';

  const diffContainer = el('div', { className: 'agy-code-box' });
  for (const line of rawDiff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      diffContainer.appendChild(el('span', { className: 'agy-diff-add', text: line }));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      diffContainer.appendChild(el('span', { className: 'agy-diff-del', text: line }));
    } else {
      diffContainer.appendChild(el('div', { text: line }));
    }
  }

  body.append(
    el('div', { className: 'agy-badge', text: `📂 ${sessionState.latestDiffTitle}` }),
    diffContainer
  );

  footer.append(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '📋 复制代码 / Diff',
      onClick: () => {
        void navigator.clipboard?.writeText(rawDiff);
      },
    }),
    el('button', {
      type: 'button',
      className: 'agy-btn',
      text: '🔄 重新扫描页面代码块',
      onClick: () => {
        sessionState.latestDiffContent = extractLatestCodeOrDiffFromDom();
        if (sheetDialog) renderSheetContents(sheetDialog, 'DiffView');
      },
    })
  );
}

function populateShellSheet(body: HTMLElement, footer: HTMLElement): void {
  const logs =
    sessionState.shellOutput.length > 0
      ? sessionState.shellOutput.join('\n\n')
      : '$ agy remote status\n[OK] Connected to Workstation via Outbound Relay\n[OK] Terminal stream ready. Any command output from the agent will stream here.';

  body.append(
    el('div', { className: 'agy-badge', text: '🖥️ BackgroundShellOutput & Terminals' }),
    el('pre', { className: 'agy-code-box', text: logs })
  );

  footer.append(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '📋 复制终端日志发给 Agent 排查',
      onClick: () => {
        sendTextToPageComposer(`请帮我分析以下终端输出：\n\`\`\`\n${logs.slice(-1500)}\n\`\`\``, false);
        sheetDialog?.close();
      },
    })
  );
}

function populateToolCallsSheet(body: HTMLElement, footer: HTMLElement): void {
  if (sessionState.toolCalls.length === 0) {
    body.appendChild(
      el(
        'div',
        { className: 'agy-card-item' },
        el('strong', { text: '🛠️ 暂无折叠的工具调用记录' }),
        el('span', {
          style: { fontSize: '0.84rem', color: 'var(--agy-muted)' },
          text: '当 Agent 执行 read_file、run_command、edit_file 等工具时，主聊天流会自动折叠冗余日志并汇总到此处。',
        })
      )
    );
  } else {
    for (const tc of sessionState.toolCalls) {
      body.appendChild(
        el(
          'details',
          { className: 'agy-card-item' },
          el(
            'summary',
            { style: { cursor: 'pointer', fontWeight: '650' } },
            `${tc.status === 'done' ? '✅' : '⏳'} ${tc.name} — ${tc.summary} (${tc.timestamp})`
          ),
          el('pre', { className: 'agy-code-box is-wrapped', text: tc.detail })
        )
      );
    }
  }

  footer.appendChild(
    el('button', {
      type: 'button',
      className: 'agy-btn',
      text: '清空记录',
      onClick: () => {
        sessionState.toolCalls = [];
        if (sheetDialog) renderSheetContents(sheetDialog, 'CollapsedToolCalls');
      },
    })
  );
}

function populateThinkingSheet(body: HTMLElement, footer: HTMLElement): void {
  const thoughts =
    sessionState.thinkingBlocks.length > 0
      ? sessionState.thinkingBlocks.join('\n\n───\n\n')
      : '当模型输出 Thinking 推理过程时，主界面会自动将其折叠为紧凑胶囊，点击即可在此独立抽屉中沉浸式阅读，避免打断手机端主对话流。';

  body.append(
    el('div', { className: 'agy-badge', text: '🧠 Model Reasoning / Chain-of-Thought' }),
    el('pre', { className: 'agy-code-box is-wrapped', text: thoughts })
  );

  footer.appendChild(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '关闭',
      onClick: () => sheetDialog?.close(),
    })
  );
}

function populateTaskListSheet(body: HTMLElement, footer: HTMLElement): void {
  for (const sub of sessionState.subagents) {
    body.appendChild(
      el(
        'div',
        { className: 'agy-card-item' },
        el(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', fontWeight: '650' } },
          el('span', { text: `🤖 ${sub.name}` }),
          el('span', { className: 'agy-badge', text: sub.status.toUpperCase() })
        ),
        el('div', { style: { fontSize: '0.84rem', color: 'var(--agy-muted)' }, text: sub.role })
      )
    );
  }

  footer.append(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '🐝 发起 /teamwork 多智能体协作',
      onClick: () => {
        sendTextToPageComposer('/teamwork ', false);
        sheetDialog?.close();
      },
    }),
    el('button', {
      type: 'button',
      className: 'agy-btn',
      text: '🚀 发起 /boost 深度验证',
      onClick: () => {
        sendTextToPageComposer('/boost ', false);
        sheetDialog?.close();
      },
    })
  );
}

function populateDeviceSessionsSheet(
  body: HTMLElement,
  footer: HTMLElement,
  dlg: HTMLDialogElement
): void {
  const unified = getUnifiedState();
  let currentTab: 'sessions' | 'devices' = 'sessions';

  // Sub-navigation bar inside Workstation Sheet: [ ⚡ 活跃会话 (N) ] [ 💻 配对设备 (M) ]
  const subNav = el('div', {
    style: {
      display: 'flex',
      gap: '6px',
      padding: '4px',
      background: 'var(--agy-surface-elev)',
      borderRadius: '12px',
      marginBottom: '4px',
    },
  });

  const sessionsTabBtn = el('button', {
    type: 'button',
    className: 'agy-btn',
    style: {
      flex: '1',
      minHeight: '36px',
      fontSize: '0.85rem',
      fontWeight: '600',
      borderRadius: '8px',
      border: 'none',
      background: 'var(--agy-surface)',
      boxShadow: '0 1px 3px rgb(0 0 0 / 0.1)',
      color: 'var(--agy-text)',
    },
    text: `⚡ 活跃会话 (${unified.sessions.length})`,
  });

  const devicesTabBtn = el('button', {
    type: 'button',
    className: 'agy-btn',
    style: {
      flex: '1',
      minHeight: '36px',
      fontSize: '0.85rem',
      fontWeight: '600',
      borderRadius: '8px',
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      color: 'var(--agy-muted)',
    },
    text: `💻 配对设备 (${unified.devices.length})`,
  });

  subNav.append(sessionsTabBtn, devicesTabBtn);
  body.appendChild(subNav);

  const contentContainer = el('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '8px' },
  });
  body.appendChild(contentContainer);

  const renderTabContent = () => {
    clearChildren(contentContainer);
    if (currentTab === 'sessions') {
      sessionsTabBtn.style.background = 'var(--agy-surface)';
      sessionsTabBtn.style.color = 'var(--agy-text)';
      sessionsTabBtn.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.1)';
      devicesTabBtn.style.background = 'transparent';
      devicesTabBtn.style.color = 'var(--agy-muted)';
      devicesTabBtn.style.boxShadow = 'none';

      if (unified.sessions.length === 0) {
        contentContainer.appendChild(
          el(
            'div',
            {
              style: {
                textAlign: 'center',
                padding: '36px 16px',
                color: 'var(--agy-muted)',
              },
            },
            el('div', { style: { fontSize: '2rem', marginBottom: '8px' }, text: '☁️' }),
            el('strong', { style: { fontSize: '0.95rem' }, text: '暂无远程会话' }),
            el('div', {
              style: { fontSize: '0.82rem', marginTop: '4px' },
              text: '在已配对的工作台上发起会话后，将在此自动汇聚显示',
            })
          )
        );
      } else {
        for (const sess of unified.sessions) {
          const isCurrent =
            unified.currentInstanceUuid === sess.deviceUuid &&
            unified.currentCascadeId === sess.cascadeId;

          const card = el(
            'div',
            {
              className: 'agy-card-item',
              style: {
                cursor: 'pointer',
                borderColor: isCurrent ? 'var(--agy-accent)' : 'var(--agy-border)',
                background: isCurrent
                  ? 'light-dark(rgba(26, 115, 232, 0.06), rgba(124, 172, 248, 0.08))'
                  : 'var(--agy-surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '12px 14px',
                borderRadius: '14px',
                borderWidth: isCurrent ? '1.5px' : '1px',
                borderStyle: 'solid',
                transition: 'border-color 150ms ease, background 150ms ease',
              },
              onClick: () => {
                dlg.close();
                openUnifiedSession(sess, sess.activeTab || 'chat');
              },
            },
            el(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                },
              },
              el('strong', {
                style: {
                  fontSize: '0.92rem',
                  color: 'var(--agy-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: '1',
                },
                text: sess.title,
              }),
              isCurrent
                ? el('span', {
                    className: 'agy-badge agy-badge-accent',
                    style: { fontSize: '0.75rem', fontWeight: '700', padding: '2px 8px' },
                    text: '当前会话',
                  })
                : el('span', {
                    style: { fontSize: '0.75rem', color: 'var(--agy-muted)', whiteSpace: 'nowrap' },
                    text: sess.lastModifiedLabel,
                  })
            ),
            el(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                },
              },
              el(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.78rem',
                    color: 'var(--agy-muted)',
                    overflow: 'hidden',
                  },
                },
                el('span', {
                  className: sess.deviceStatus === 'RUNNING' ? 'agy-status-dot' : 'agy-status-dot offline',
                  style: { width: '6px', height: '6px', flexShrink: '0' },
                }),
                el('span', {
                  style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  text: sess.deviceName,
                }),
                el('span', { text: '·' }),
                el('span', {
                  style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  text: `📁 ${sess.projectId}`,
                })
              ),
              el('span', {
                style: {
                  color: 'var(--agy-muted)',
                  fontSize: '1rem',
                  lineHeight: '1',
                  flexShrink: '0',
                },
                text: '›',
              })
            )
          );
          contentContainer.appendChild(card);
        }
      }
    } else {
      // Devices Tab
      sessionsTabBtn.style.background = 'transparent';
      sessionsTabBtn.style.color = 'var(--agy-muted)';
      sessionsTabBtn.style.boxShadow = 'none';
      devicesTabBtn.style.background = 'var(--agy-surface)';
      devicesTabBtn.style.color = 'var(--agy-text)';
      devicesTabBtn.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.1)';

      for (const dev of unified.devices) {
        const isCurrent = unified.currentInstanceUuid === dev.uuid;
        const devSessions = unified.sessions.filter((s) => s.deviceUuid === dev.uuid);

        const card = el(
          'div',
          {
            className: 'agy-card-item',
            style: {
              cursor: 'pointer',
              borderColor: isCurrent ? 'var(--agy-accent)' : 'var(--agy-border)',
              background: isCurrent
                ? 'light-dark(rgba(26, 115, 232, 0.06), rgba(124, 172, 248, 0.08))'
                : 'var(--agy-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '14px',
              borderWidth: isCurrent ? '1.5px' : '1px',
              borderStyle: 'solid',
            },
            onClick: () => {
              dlg.close();
              if (dev.uuid === '__remote_conversations__') {
                window.location.assign('https://antigravity.google.com/remote');
              } else {
                window.location.assign(
                  `https://antigravity.google.com/r/${encodeURIComponent(dev.uuid)}`
                );
              }
            },
          },
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0' } },
            el('span', {
              style: { fontSize: '1.25rem', flexShrink: '0' },
              text: dev.group === 'remoteConversations' ? '☁️' : '💻',
            }),
            el(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
              el('strong', {
                style: {
                  fontSize: '0.9rem',
                  color: 'var(--agy-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
                text: dev.displayName,
              }),
              el(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.78rem',
                    color: 'var(--agy-muted)',
                  },
                },
                el('span', {
                  className:
                    dev.status === 'RUNNING'
                      ? 'agy-status-dot'
                      : dev.status === 'IDLE'
                        ? 'agy-status-dot idle'
                        : 'agy-status-dot offline',
                  style: { width: '6px', height: '6px', flexShrink: '0' },
                }),
                el('span', {
                  text:
                    dev.status === 'RUNNING'
                      ? '在线'
                      : dev.status === 'IDLE'
                        ? '空闲'
                        : '离线',
                }),
                el('span', { text: '·' }),
                el('span', { text: `${devSessions.length} 个会话` })
              )
            )
          ),
          el('span', {
            className: 'agy-badge',
            style: {
              fontSize: '0.75rem',
              fontWeight: '600',
              flexShrink: '0',
            },
            text: isCurrent ? '当前工作台' : '切换连接',
          })
        );
        contentContainer.appendChild(card);
      }
    }
  };

  sessionsTabBtn.addEventListener('click', () => {
    currentTab = 'sessions';
    renderTabContent();
  });
  devicesTabBtn.addEventListener('click', () => {
    currentTab = 'devices';
    renderTabContent();
  });

  renderTabContent();

  // Clean Native Footer
  footer.append(
    el('button', {
      type: 'button',
      className: 'agy-btn agy-btn-primary',
      text: '✦ 新建会话',
      onClick: () => {
        dlg.close();
        if (window.location.hostname.includes('gemini.google.com')) {
          sendToNative({ type: 'SWITCH_ENGINE', engine: 'antigravity' });
        } else {
          window.location.assign('https://antigravity.google.com/remote');
        }
      },
    }),
    el('button', {
      type: 'button',
      className: 'agy-btn',
      text: '↻ 刷新设备与会话',
      onClick: () => {
        void refreshAllMultiDeviceSessions().then(() => {
          renderSheetContents(dlg, 'DeviceSessions');
        });
      },
    })
  );
}

function populateSettingsSheet(
  body: HTMLElement,
  footer: HTMLElement,
  dlg: HTMLDialogElement
): void {
  const unified = getUnifiedState();
  const user = unified.userProfile;
  const onlineCount = unified.devices.filter((d) => d.status === 'RUNNING').length;
  const totalSessions = unified.sessions.length;

  const container = el('div', { className: 'agy-settings-container' });

  // 1. Google Account Profile Card
  let avatarEl: HTMLElement;
  if (user?.avatarUrl) {
    avatarEl = el('img', {
      className: 'agy-account-avatar',
      attrs: { src: user.avatarUrl, alt: user.name || 'User avatar' },
    });
  } else {
    avatarEl = el(
      'div',
      { className: 'agy-account-avatar-placeholder' },
      el('span', { text: user?.name ? user.name.slice(0, 1).toUpperCase() : '✦' })
    );
  }

  const profileDetails = el(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '0', flex: '1' } },
    el('div', {
      style: {
        fontSize: '1.02rem',
        fontWeight: '700',
        color: 'var(--agy-text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      text: user?.name || 'Google 账号 (统一身份认证)',
    }),
    el('div', {
      style: {
        fontSize: '0.8rem',
        color: 'var(--agy-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      text: user?.email || '已连接 Google 统一身份认证',
    }),
    el('span', {
      className: 'agy-badge',
      style: {
        background: 'light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))',
        color: '#16a34a',
        fontWeight: '650',
        fontSize: '0.72rem',
        marginTop: '2px',
        alignSelf: 'flex-start',
      },
      text: user?.tier || '✦ Google One AI Premium',
    })
  );

  const accountCard = el('div', { className: 'agy-account-card' }, avatarEl, profileDetails);
  container.appendChild(accountCard);

  // 2. Google Account Session Sync / Cookie Import Card
  const cookieCard = createCookieImportCard(() => {
    dlg.close();
  });
  const cookieSection = el(
    'div',
    { className: 'agy-settings-section' },
    el('div', { className: 'agy-settings-section-title', text: '账号登录与凭证同步' }),
    cookieCard
  );
  container.appendChild(cookieSection);

  // 3. Account Center Quick Links Group
  const accountGroup = el(
    'div',
    { className: 'agy-settings-group' },
    // Row 1: Manage Google Account
    el(
      'button',
      {
        type: 'button',
        className: 'agy-settings-row agy-interactive',
        style: { width: '100%', textAlign: 'left' },
        onClick: () => {
          window.open('https://myaccount.google.com', '_blank');
        },
      },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(66, 133, 244, 0.12), rgba(66, 133, 244, 0.22))', color: '#1a73e8' },
          },
          '👤'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '管理 Google 账号' }),
          el('span', { className: 'agy-settings-row-desc', text: '个人资料、安全与付款方式' })
        )
      ),
      el('span', { className: 'agy-settings-chevron', text: '›' })
    ),
    // Row 2: Switch Account
    el(
      'button',
      {
        type: 'button',
        className: 'agy-settings-row agy-interactive',
        style: { width: '100%', textAlign: 'left' },
        onClick: () => {
          window.open('https://accounts.google.com/AddSession', '_blank');
        },
      },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(168, 85, 247, 0.12), rgba(168, 85, 247, 0.22))', color: '#9333ea' },
          },
          '⇄'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '切换或添加其他账号' }),
          el('span', { className: 'agy-settings-row-desc', text: '在浏览器中登录多账号凭证' })
        )
      ),
      el('span', { className: 'agy-settings-chevron', text: '›' })
    )
  );

  const accountSection = el(
    'div',
    { className: 'agy-settings-section' },
    el('div', { className: 'agy-settings-section-title', text: '账号中心' }),
    accountGroup
  );
  container.appendChild(accountSection);

  // 3. Preferences Section
  const isDarkCurrent =
    document.documentElement.getAttribute('data-agy-unified-theme') === 'dark' ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const prefGroup = el(
    'div',
    { className: 'agy-settings-group' },
    // Row: Engine Switch
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.22))', color: '#2563eb' },
          },
          '✦'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '核心启动引擎' }),
          el('span', { className: 'agy-settings-row-desc', text: '优先呈现的工作区' })
        )
      ),
      (() => {
        const seg = el('div', { className: 'agy-settings-segmented' });
        const chatBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(unified.activeEngine === 'gemini') },
          text: '✦ Gemini',
          onClick: () => {
            if (unified.activeEngine !== 'gemini') {
              sendToNative({ type: 'SWITCH_ENGINE', engine: 'gemini' });
              chatBtn.setAttribute('aria-checked', 'true');
              codeBtn.setAttribute('aria-checked', 'false');
            }
          },
        });
        const codeBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(unified.activeEngine === 'antigravity') },
          text: '⚡ Code',
          onClick: () => {
            if (unified.activeEngine !== 'antigravity') {
              sendToNative({ type: 'SWITCH_ENGINE', engine: 'antigravity' });
              chatBtn.setAttribute('aria-checked', 'false');
              codeBtn.setAttribute('aria-checked', 'true');
            }
          },
        });
        seg.append(chatBtn, codeBtn);
        return seg;
      })()
    ),
    // Row: Theme Switch
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.22))', color: '#d97706' },
          },
          '🎨'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '界面外观主题' }),
          el('span', { className: 'agy-settings-row-desc', text: '全局深色 / 浅色模式' })
        )
      ),
      (() => {
        const seg = el('div', { className: 'agy-settings-segmented' });
        const lightBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(!isDarkCurrent) },
          text: '☀️ 浅色',
          onClick: () => {
            document.documentElement.setAttribute('data-agy-unified-theme', 'light');
            try {
              localStorage.setItem('agy.unifiedTheme', 'light');
            } catch {}
            sendToNative({ type: 'UPDATE_THEME', isDark: false });
            lightBtn.setAttribute('aria-checked', 'true');
            darkBtn.setAttribute('aria-checked', 'false');
          },
        });
        const darkBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(isDarkCurrent) },
          text: '🌙 深色',
          onClick: () => {
            document.documentElement.setAttribute('data-agy-unified-theme', 'dark');
            try {
              localStorage.setItem('agy.unifiedTheme', 'dark');
            } catch {}
            sendToNative({ type: 'UPDATE_THEME', isDark: true });
            lightBtn.setAttribute('aria-checked', 'false');
            darkBtn.setAttribute('aria-checked', 'true');
          },
        });
        seg.append(lightBtn, darkBtn);
        return seg;
      })()
    ),
    // Row: Global Font Size
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.22))', color: '#6366f1' },
          },
          '🔤'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '全局字体大小' }),
          el('span', { className: 'agy-settings-row-desc', text: '排版字号 (默认 14px 推荐)' })
        )
      ),
      (() => {
        const seg = el('div', { className: 'agy-settings-segmented' });
        const sizes: Array<{ id: UnifiedFontSize; label: string }> = [
          { id: '12px', label: '12' },
          { id: '14px', label: '14 (默认)' },
          { id: '16px', label: '16' },
          { id: '18px', label: '18' },
        ];
        const curSize = getUnifiedFontSize();
        const btns: HTMLButtonElement[] = [];
        for (const s of sizes) {
          const btn = el('button', {
            type: 'button',
            className: 'agy-settings-segment-btn',
            aria: { checked: String(curSize === s.id) },
            text: s.label,
            onClick: () => {
              setUnifiedFontSize(s.id);
              btns.forEach((b, idx) => b.setAttribute('aria-checked', String(sizes[idx].id === s.id)));
            },
          });
          btns.push(btn);
          seg.append(btn);
        }
        return seg;
      })()
    ),
    // Row: Topbar Height & Density
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(236, 72, 153, 0.12), rgba(236, 72, 153, 0.22))', color: '#ec4899' },
          },
          '📏'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '顶栏高度与触控密度' }),
          el('span', { className: 'agy-settings-row-desc', text: '导航栏垂直高度 (默认 54px)' })
        )
      ),
      (() => {
        const seg = el('div', { className: 'agy-settings-segmented' });
        const heights: Array<{ id: UnifiedTopbarHeight; label: string }> = [
          { id: '48px', label: '48 紧凑' },
          { id: '54px', label: '54 标准' },
          { id: '60px', label: '60 舒适' },
        ];
        const curH = getUnifiedTopbarHeight();
        const btns: HTMLButtonElement[] = [];
        for (const h of heights) {
          const btn = el('button', {
            type: 'button',
            className: 'agy-settings-segment-btn',
            aria: { checked: String(curH === h.id) },
            text: h.label,
            onClick: () => {
              setUnifiedTopbarHeight(h.id);
              btns.forEach((b, idx) => b.setAttribute('aria-checked', String(heights[idx].id === h.id)));
            },
          });
          btns.push(btn);
          seg.append(btn);
        }
        return seg;
      })()
    ),
    // Row: Workspace Subtabs (💬 🔍 >_)
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.22))', color: '#0284c7' },
          },
          '⚡'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: 'Code 顶栏子视图快捷入口' }),
          el('span', { className: 'agy-settings-row-desc', text: '顶栏右侧会话/搜索/终端图标 (💬 🔍 >_)' })
        )
      ),
      (() => {
        const seg = el('div', { className: 'agy-settings-segmented' });
        const showCurrent = getShowSubtabs();
        const onBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(showCurrent) },
          text: '开启',
          onClick: () => {
            setShowSubtabs(true);
            onBtn.setAttribute('aria-checked', 'true');
            offBtn.setAttribute('aria-checked', 'false');
          },
        });
        const offBtn = el('button', {
          type: 'button',
          className: 'agy-settings-segment-btn',
          aria: { checked: String(!showCurrent) },
          text: '极简隐藏',
          onClick: () => {
            setShowSubtabs(false);
            onBtn.setAttribute('aria-checked', 'false');
            offBtn.setAttribute('aria-checked', 'true');
          },
        });
        seg.append(onBtn, offBtn);
        return seg;
      })()
    ),
    // Row: IME Enter Guard
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.22))', color: '#059669' },
          },
          '⌨️'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '中文输入法防抖保护' }),
          el('span', { className: 'agy-settings-row-desc', text: 'IME 3 段组合键拦截防误发' })
        )
      ),
      el('span', {
        className: 'agy-badge',
        style: {
          background: 'light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))',
          color: '#16a34a',
          fontWeight: '650',
          fontSize: '0.72rem',
        },
        text: '已开启 ✓',
      })
    )
  );

  const prefSection = el(
    'div',
    { className: 'agy-settings-section' },
    el('div', { className: 'agy-settings-section-title', text: '偏好设置' }),
    prefGroup
  );
  container.appendChild(prefSection);

  // 4. Workstations & Data Section
  const syncGroup = el(
    'div',
    { className: 'agy-settings-group' },
    // Row 1: Paired Devices & Sessions (Jump to DeviceSessions sheet)
    el(
      'button',
      {
        type: 'button',
        className: 'agy-settings-row agy-interactive',
        style: { width: '100%', textAlign: 'left' },
        onClick: () => {
          renderSheetContents(dlg, 'DeviceSessions');
        },
      },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(20, 184, 166, 0.12), rgba(20, 184, 166, 0.22))', color: '#0d9488' },
          },
          '💻'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '多端工作台与会话' }),
          el('span', {
            className: 'agy-settings-row-desc',
            text: `${onlineCount} 台工作台在线 · ${totalSessions} 个已索引会话`,
          })
        )
      ),
      el(
        'div',
        { className: 'agy-settings-row-right' },
        el('span', { className: 'agy-settings-row-value', text: '检视' }),
        el('span', { className: 'agy-settings-chevron', text: '›' })
      )
    ),
    // Row 2: Instant Rescan
    el(
      'button',
      {
        type: 'button',
        className: 'agy-settings-row agy-interactive',
        style: { width: '100%', textAlign: 'left' },
        onClick: (e: MouseEvent) => {
          const btn = e.currentTarget as HTMLElement;
          const valEl = btn.querySelector('.agy-settings-row-value');
          if (valEl) valEl.textContent = '同步中...';
          void refreshAllMultiDeviceSessions().then(() => {
            void pullStateFromNativeHost().then(() => {
              if (valEl) valEl.textContent = '已更新 ✓';
              setTimeout(() => {
                if (valEl) valEl.textContent = '立即拉取';
              }, 2000);
            });
          });
        },
      },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.22))', color: '#0284c7' },
          },
          '↻'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '同步全端工作台状态' }),
          el('span', { className: 'agy-settings-row-desc', text: '重新扫描 Jetski 工作台与 Gemini' })
        )
      ),
      el(
        'div',
        { className: 'agy-settings-row-right' },
        el('span', {
          className: 'agy-settings-row-value',
          style: { color: 'var(--agy-accent)' },
          text: '立即拉取',
        }),
        el('span', { className: 'agy-settings-chevron', text: '›' })
      )
    ),
    // Row 3: Clear Cache
    el(
      'button',
      {
        type: 'button',
        className: 'agy-settings-row agy-interactive',
        style: { width: '100%', textAlign: 'left' },
        onClick: () => {
          try {
            localStorage.removeItem('agy.unifiedAppState.v1');
          } catch {}
          dlg.close();
          window.location.reload();
        },
      },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.22))', color: '#dc2626' },
          },
          '🗑️'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: '清理本地会话缓存' }),
          el('span', { className: 'agy-settings-row-desc', text: '重置离线聚合状态并重新载入' })
        )
      ),
      el(
        'div',
        { className: 'agy-settings-row-right' },
        el('span', {
          className: 'agy-settings-row-value',
          style: { color: 'var(--agy-danger)' },
          text: '清理',
        }),
        el('span', { className: 'agy-settings-chevron', text: '›' })
      )
    )
  );

  const syncSection = el(
    'div',
    { className: 'agy-settings-section' },
    el('div', { className: 'agy-settings-section-title', text: '工作台与数据' }),
    syncGroup
  );
  container.appendChild(syncSection);

  // 5. About Section
  const aboutGroup = el(
    'div',
    { className: 'agy-settings-group' },
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(100, 116, 139, 0.12), rgba(100, 116, 139, 0.22))', color: '#475569' },
          },
          '✦'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: 'Antigravity Unified App' }),
          el('span', { className: 'agy-settings-row-desc', text: 'Tauri v2 + Android Dual Engine Fusion' })
        )
      ),
      el('span', { className: 'agy-settings-row-value', style: { fontFamily: 'monospace' }, text: 'v0.1.0' })
    ),
    el(
      'div',
      { className: 'agy-settings-row' },
      el(
        'div',
        { className: 'agy-settings-row-left' },
        el(
          'div',
          {
            className: 'agy-settings-icon',
            style: { background: 'light-dark(rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.22))', color: '#4f46e5' },
          },
          '🛡️'
        ),
        el(
          'div',
          { className: 'agy-settings-row-text' },
          el('span', { className: 'agy-settings-row-title', text: 'Trusted Types & CSP 安全' }),
          el('span', { className: 'agy-settings-row-desc', text: 'Zero-innerHTML DOMSafe 隔离' })
        )
      ),
      el('span', {
        className: 'agy-badge',
        style: {
          background: 'light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))',
          color: '#16a34a',
          fontWeight: '650',
          fontSize: '0.72rem',
        },
        text: '已合规 ✓',
      })
    )
  );

  const aboutSection = el(
    'div',
    { className: 'agy-settings-section' },
    el('div', { className: 'agy-settings-section-title', text: '关于与安全' }),
    aboutGroup
  );
  container.appendChild(aboutSection);

  body.appendChild(container);

  // Footer: Minimalist elegant note
  clearChildren(footer);
  footer.style.borderTop = 'none';
  footer.style.padding = '4px 18px 16px';
  footer.style.justifyContent = 'center';
  footer.appendChild(
    el('span', {
      style: {
        fontSize: '0.74rem',
        color: 'var(--agy-muted)',
        opacity: '0.75',
        textAlign: 'center',
        width: '100%',
        display: 'block',
      },
      text: 'Google Antigravity · Unified Chat & Code Remote Control',
    })
  );
}

function extractLatestArtifactOrPlanFromDom(): string {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('article, .markdown-body, [data-testid*="artifact"], main pre')
  ).filter((n) => !n.closest('dialog.agy-bottom-sheet'));
  const last = candidates.at(-1);
  return last?.textContent?.trim() ?? '';
}

function extractLatestCodeOrDiffFromDom(): string {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('pre code, pre')).filter(
    (n) => !n.closest('dialog.agy-bottom-sheet') && (n.textContent?.trim().length ?? 0) > 10
  );
  const last = blocks.at(-1);
  return last?.textContent?.trim() ?? '';
}
