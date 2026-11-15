// Gemini Web Home Bridge (Loaded into https://gemini.google.com/app*)
// Strict Trusted Types compliance: Zero innerHTML/outerHTML/insertAdjacentHTML.

import { openClaudeBottomSheet, sessionState } from './claude-bottom-sheets';
import { adoptStyleSheet, el, ensureModernHeadMeta, sendToNative } from './dom-safe';
import { mountAccountsGoogleLoginHelper } from './google-cookie-helper';
import {
  pullStateFromNativeHost,
  syncGeminiChatsFromDom,
  syncUserProfileFromDom,
} from './multi-device-aggregator';
import { mountQuickComposerAndImeGuard } from './quick-composer';
import { injectSharedNavBar } from './shared-nav-bar';

const GEMINI_FUSION_CSS = `
.agy-handoff-code-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: rgba(37, 99, 235, 0.14);
  color: #60a5fa;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
}

.agy-handoff-code-btn:hover {
  background: rgba(37, 99, 235, 0.24);
}

/* Hide Gemini Web "Chat with Gemini in an app / Try app" mobile upsell banner */
upsell-banner,
mobile-upsell-banner,
[data-test-id*="upsell"],
a[href*="play.google.com/store/apps/details"] {
  display: none !important;
}

/* Mobile-only: Keep Gemini's side nav mounted offscreen so it fetches and renders conversation history for the Unified Drawer */
html[data-agy-form-factor="mobile"] bard-sidenav,
html[data-agy-form-factor="mobile"] mat-sidenav,
html[data-agy-form-factor="mobile"] .side-nav-container {
  position: fixed !important;
  left: -9999px !important;
  top: 0 !important;
  width: 320px !important;
  opacity: 0 !important;
  pointer-events: none !important;
  z-index: -10 !important;
}

html[data-agy-form-factor="mobile"] mat-sidenav-content,
html[data-agy-form-factor="mobile"] bard-sidenav-content,
html[data-agy-form-factor="mobile"] .mat-drawer-content {
  margin-left: 0 !important;
  margin-right: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
}

/* Mobile-only: Hide Gemini Web's native menu and onegoogle bars on small screens */
html[data-agy-form-factor="mobile"] button[aria-label*="Main menu"],
html[data-agy-form-factor="mobile"] button[aria-label*="主菜单"],
html[data-agy-form-factor="mobile"] button[data-test-id="side-nav-button"],
html[data-agy-form-factor="mobile"] .side-nav-button,
html[data-agy-form-factor="mobile"] .boqOnegoogleliteOgbOneGoogleBar,
html[data-agy-form-factor="mobile"] header.gb_Pa,
html[data-agy-form-factor="mobile"] .gb_Pa,
html[data-agy-form-factor="mobile"] .gb_Fd {
  position: absolute !important;
  left: -9999px !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Suppress all backdrop overlays so they NEVER intercept user taps on the chat input / composer */
mat-drawer-backdrop,
.mat-drawer-backdrop,
mat-sidenav-backdrop,
.mat-sidenav-backdrop,
.cdk-overlay-backdrop {
  display: none !important;
  pointer-events: none !important;
  visibility: hidden !important;
}

/* Ensure editor, rich-textarea, and composer are always interactive and focusable for IME */
.ql-editor,
rich-textarea,
rich-textarea *,
input,
textarea,
[contenteditable="true"] {
  pointer-events: auto !important;
  user-select: text !important;
  -webkit-user-select: text !important;
  touch-action: manipulation !important;
}

/* Clean adaptive theme support for Gemini Web */
html[data-agy-unified-theme="light"],
html[data-agy-unified-theme="light"] body {
  background-color: #ffffff !important;
  color: #1f1f1f !important;
}

html[data-agy-unified-theme="dark"],
html[data-agy-unified-theme="dark"] body {
  background-color: #131314 !important;
  color: #e3e3e3 !important;
}
`;

let menuTriggered = false;
function triggerGeminiMenuToLoadConversations(): void {
  if (menuTriggered) return;
  // If chat links already exist in DOM, no need to trigger menu
  const hasChats = document.querySelector('a[href*="/app/"]');
  if (hasChats) {
    menuTriggered = true;
    return;
  }
  const menuBtn = document.querySelector<HTMLElement>(
    'button[aria-label*="主菜单"], button[aria-label*="Main menu"], button[data-test-id="side-nav-button"], .side-nav-button'
  );
  if (menuBtn) {
    menuTriggered = true;
    menuBtn.click();
  }
}

function openGeminiMultiDeviceSheet(): void {
  void pullStateFromNativeHost().then(() => {
    openClaudeBottomSheet('DeviceSessions');
  });
}

function scanGeminiCodeBlocks(): void {
  const codeBlocks = document.querySelectorAll<HTMLElement>('pre, code-block');
  codeBlocks.forEach((block) => {
    if (block.dataset.agyHandoffAttached === 'true') return;
    block.dataset.agyHandoffAttached = 'true';

    const handoffBtn = el('button', {
      className: 'agy-handoff-code-btn',
      textContent: '⚡ Send to Antigravity Code',
      attrs: {
        type: 'button',
        title: 'Continue or execute this snippet in Antigravity Remote Control',
      },
      onClick: () => {
        const snippet = (block.textContent || '').trim();
        sessionState.latestDiffContent = snippet;
        sendToNative({
          type: 'TELEPORT_TO_CODE',
          prompt: `请基于以下来自 Gemini 对话的代码片段继续实现或验证：\n\`\`\`\n${snippet.slice(0, 2000)}\n\`\`\``,
        });
      },
    });

    block.parentElement?.append(handoffBtn);
  });
}

function bootGeminiBridge(): void {
  // Safe helper for Google Accounts auth block page:
  // Mount unobtrusive banner so user can open external browser & import session cookies
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('accounts.google.com') ||
      window.location.pathname.startsWith('/accounts'))
  ) {
    if (typeof window !== 'undefined' && window.self === window.top) {
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
    window.addEventListener('DOMContentLoaded', bootGeminiBridge, { once: true });
    return;
  }

  ensureModernHeadMeta();

  adoptStyleSheet('agy-gemini-fusion-styles', GEMINI_FUSION_CSS);
  injectSharedNavBar('gemini', () => openGeminiMultiDeviceSheet());
  scanGeminiCodeBlocks();
  triggerGeminiMenuToLoadConversations();

  void pullStateFromNativeHost().then(() => {
    syncGeminiChatsFromDom();
    syncUserProfileFromDom();
  });

  window.setInterval(() => {
    void pullStateFromNativeHost().then(() => {
      syncGeminiChatsFromDom();
      syncUserProfileFromDom();
    });
  }, 10000);

  let mutationDebounceTimer: number | null = null;
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer !== null) return;
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      scanGeminiCodeBlocks();
      syncGeminiChatsFromDom();
    }, 2500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

bootGeminiBridge();
