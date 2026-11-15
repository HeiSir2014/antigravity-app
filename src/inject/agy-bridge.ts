// Antigravity Remote WebView Bridge
// Supports both:
// 1. Top-level Host Frame (`https://antigravity.google.com/remote` & `/r/:uuid`)
// 2. Inner Guest `#hubFrame` (`https://antigravity.static.usercontent.goog/web/<version>/?iframe=true`)
// Strict Trusted Types compliance: Zero innerHTML/outerHTML/insertAdjacentHTML.

import {
  executePermissionDecision,
  openClaudeBottomSheet,
  sendTextToPageComposer,
  sessionState,
} from './claude-bottom-sheets';
import {
  adoptStyleSheet,
  consumePendingTeleport,
  ensureModernHeadMeta,
  openExternalInSystemBrowser,
  sendToNative,
  setUnifiedTheme,
} from './dom-safe';
import { mountAccountsGoogleLoginHelper } from './google-cookie-helper';
import {
  ensureActiveConversationOpen,
  installAntigravityRpcHooks,
  pullStateFromNativeHost,
  refreshAllMultiDeviceSessions,
  syncUserProfileFromDom,
} from './multi-device-aggregator';
import { mountQuickComposerAndImeGuard } from './quick-composer';
import { injectSharedNavBar } from './shared-nav-bar';

const ALLOWED_ORIGINS = new Set([
  'https://antigravity.google.com',
  'https://antigravity.static.usercontent.goog',
  'https://gemini.google.com',
]);

const isTopFrame = (() => {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
})();

// Install RPC hooks in the top-level antigravity.google.com frame
if (
  isTopFrame &&
  typeof window !== 'undefined' &&
  !window.location.hostname.includes('accounts.google.com')
) {
  installAntigravityRpcHooks();
}

function openLiveMultiDeviceSheet(): void {
  void refreshAllMultiDeviceSessions().then(() => {
    openClaudeBottomSheet('DeviceSessions');
  });
}

function setupTopFrameMessageListener(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (!ALLOWED_ORIGINS.has(event.origin)) return;
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    // When #hubFrame navigates conversations inside /r/:uuid, sync our multi-device state
    if (payload.type === 'URL_CHANGED') {
      void refreshAllMultiDeviceSessions();
    }

    if (payload.type === 'AGY_OPEN_EXTERNAL_URL' && typeof payload.url === 'string') {
      openExternalInSystemBrowser(payload.url);
    }

    if (payload.type === 'AGY_TOOL_APPROVAL_REQUEST') {
      const requestId = String(payload.requestId ?? Date.now());
      const toolName = String(payload.toolName ?? 'RunCommand');
      const commandOrDiff = Array.isArray(payload.diffLines)
        ? payload.diffLines.map(String).join('\n')
        : String(payload.commandOrDiff ?? 'Executing requested agent tool action');

      sessionState.pendingApproval = {
        sessionId: String(payload.sessionId ?? 'active'),
        requestId,
        toolName,
        commandOrDiff,
        timestamp: Date.now(),
      };
      sendToNative({
        type: 'PERMISSION_PROMPT',
        toolName,
        commandText: commandOrDiff,
        requestId,
      });
      openClaudeBottomSheet('ApprovalDiffDetail');
    }

    if (payload.type === 'AGY_NATIVE_PERMISSION_ACTION') {
      const decision =
        payload.decision === 'APPROVE' || payload.action === 'APPROVE'
          ? 'APPROVE'
          : payload.decision === 'DENY_WITH_COMMENT' || payload.action === 'DENY_WITH_COMMENT'
            ? 'DENY_WITH_COMMENT'
            : 'DENY';
      executePermissionDecision(decision, payload.comment ? String(payload.comment) : undefined);
    }
  });

  // Expose native Android notification receiver hook on window
  window.__AGY_RECEIVE_NATIVE_EVENT__ = (eventJson: string) => {
    try {
      const parsed = JSON.parse(eventJson);
      window.postMessage(
        {
          type: 'AGY_NATIVE_PERMISSION_ACTION',
          ...parsed,
        },
        window.location.origin
      );
    } catch {
      // Ignore malformed JSON
    }
  };

  window.addEventListener('popstate', () => {
    void refreshAllMultiDeviceSessions();
  });
}

/**
 * Runs inside `#hubFrame` (`https://antigravity.static.usercontent.goog/web/<version>/?iframe=true`).
 * Does NOT mount duplicate topbars or docks; instead attaches IME-safe Enter guard and executes
 * composer/approval commands forwarded from the top-level host frame.
 */
function bootGuestHubFrameBridge(): void {
  adoptStyleSheet(
    'agy-guest-hubframe-styles',
    `
    html, body {
      max-width: 100vw !important;
      height: 100% !important;
      max-height: 100% !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .theme-standalone,
    .h-\\[100dvh\\] {
      height: 100% !important;
      max-height: 100% !important;
    }
    /* Hide mobile-specific redundant headers only on mobile form factors */
    html[data-agy-form-factor="mobile"] [data-testid="mobile-back-to-home"],
    html[data-agy-form-factor="mobile"] button[aria-label="Back to home"],
    html[data-agy-form-factor="mobile"] .border-b.border-border[style*="safe-area-inset-top"] {
      display: none !important;
    }
    `
  );

  // Attach IME-safe Enter guard inside the guest iframe
  let lastCompositionEndAt: number | null = null;
  document.addEventListener(
    'compositionend',
    (event) => {
      lastCompositionEndAt = event.timeStamp;
    },
    true
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        const isComposingSafeguard =
          event.isComposing ||
          event.keyCode === 229 ||
          (lastCompositionEndAt !== null &&
            Math.abs(event.timeStamp - lastCompositionEndAt) < 50);
        if (isComposingSafeguard) {
          event.stopPropagation();
        }
      }
    },
    true
  );

  // Listen for forwarded composer / approval actions from top-level https://antigravity.google.com
  window.addEventListener('message', (event: MessageEvent) => {
    if (!ALLOWED_ORIGINS.has(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'AGY_GUEST_COMMAND') return;

    if (data.action === 'INSERT_COMPOSER' && typeof data.text === 'string') {
      sendTextToPageComposer(data.text, Boolean(data.autoSubmit));
    } else if (data.action === 'PERMISSION_DECISION' && typeof data.decision === 'string') {
      executePermissionDecision(
        data.decision as 'APPROVE' | 'DENY' | 'DENY_WITH_COMMENT',
        typeof data.comment === 'string' ? data.comment : undefined
      );
    } else if (
      data.action === 'SET_THEME' &&
      (data.theme === 'light' || data.theme === 'dark')
    ) {
      setUnifiedTheme(data.theme, false);
    } else if (data.action === 'TOGGLE_AUX_PANEL') {
      const auxBtn = document.querySelector<HTMLElement>('[data-testid="mobile-toggle-aux-sidebar"]');
      auxBtn?.click();
    }
  });

  // Observe tool approval cards appearing inside #hubFrame and forward them to the top-frame sheet & Android Notification
  let lastNotifiedSignature = '';
  const scanGuestApprovalPrompts = () => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button'));
    const approveBtn = buttons.find((b) =>
      /\b(approve|allow|accept|run command|confirm|批准|允许)\b/i.test(
        `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`
      )
    );
    const denyBtn = buttons.find((b) =>
      /\b(deny|reject|decline|cancel|拒绝)\b/i.test(
        `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`
      )
    );
    if (!approveBtn || !denyBtn) return;

    const card = approveBtn.closest('section, article, [role="region"], div') ?? document.body;
    const preText = card.querySelector('pre, code')?.textContent?.trim() || '';
    const cardText = (preText || card.textContent || '').trim().slice(0, 1200);
    if (!cardText || cardText === lastNotifiedSignature) return;
    lastNotifiedSignature = cardText;

    try {
      window.parent?.postMessage(
        {
          type: 'AGY_TOOL_APPROVAL_REQUEST',
          requestId: `req_${Date.now()}`,
          toolName: preText ? 'Terminal / Code Action' : 'Agent Permission Request',
          commandOrDiff: cardText,
        },
        'https://antigravity.google.com'
      );
    } catch {
      // Ignore cross-origin postMessage errors
    }
  };

  const observer = new MutationObserver(() => {
    scanGuestApprovalPrompts();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function checkAndConsumeTeleport(): Promise<void> {
  const teleported = await consumePendingTeleport();
  if (teleported) {
    window.setTimeout(() => {
      sendTextToPageComposer(teleported, false);
    }, 600);
  }
}

function bootAntigravityBridge(): void {
  // Safe helper for Google Accounts auth block page:
  // Mount unobtrusive banner so user can open external browser & import session cookies
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('accounts.google.com') ||
      window.location.pathname.startsWith('/accounts'))
  ) {
    if (isTopFrame) {
      if (!document.body) {
        window.addEventListener('DOMContentLoaded', () => mountAccountsGoogleLoginHelper(), {
          once: true,
        });
      } else {
        mountAccountsGoogleLoginHelper();
      }
    }
    return;
  }

  if (!document.body) {
    window.addEventListener('DOMContentLoaded', bootAntigravityBridge, { once: true });
    return;
  }

  ensureModernHeadMeta();

  if (!isTopFrame) {
    bootGuestHubFrameBridge();
    return;
  }

  injectSharedNavBar('antigravity', () => openLiveMultiDeviceSheet());
  mountQuickComposerAndImeGuard();
  setupTopFrameMessageListener();
  ensureActiveConversationOpen();

  // Check if user teleported a code snippet / prompt from Gemini (on initial load or window focus/visibility)
  void checkAndConsumeTeleport();
  window.addEventListener('focus', () => {
    void checkAndConsumeTeleport();
    void pullStateFromNativeHost();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkAndConsumeTeleport();
      void pullStateFromNativeHost();
    }
  });

  void pullStateFromNativeHost();
  void refreshAllMultiDeviceSessions();
  syncUserProfileFromDom();

  window.setInterval(() => {
    void refreshAllMultiDeviceSessions();
    syncUserProfileFromDom();
  }, 12000);
}

bootAntigravityBridge();
