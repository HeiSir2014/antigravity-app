import { openClaudeBottomSheet } from './claude-bottom-sheets';
import {
  adoptStyleSheet,
  clearChildren,
  el,
  getShowSubtabs,
  getUnifiedTheme,
  subscribeUnifiedTheme,
  toggleUnifiedTheme,
} from './dom-safe';
import {
  getUnifiedState,
  openUnifiedSession,
  pullStateFromNativeHost,
  refreshAllMultiDeviceSessions,
  subscribeUnifiedState,
  type UnifiedAppState,
} from './multi-device-aggregator';

const NAV_CSS = `
:root {
  --agy-topbar-h: 54px;
  --agy-font-size: 14px;
}

:root,
html[data-agy-unified-theme="light"] {
  color-scheme: light;
  --agy-bar-bg: rgba(255, 255, 255, 0.94);
  --agy-bar-border: rgba(15, 23, 42, 0.08);
  --agy-bar-fg: #0f172a;
  --agy-bar-muted: #64748b;
  --agy-pill-active: #eef2ff;
  --agy-accent: #2563eb;
  --agy-card-bg: #f8fafc;
  --agy-drawer-bg: #ffffff;
}

html[data-agy-unified-theme="dark"] {
  color-scheme: dark;
  --agy-bar-bg: rgba(13, 15, 20, 0.94);
  --agy-bar-border: rgba(255, 255, 255, 0.1);
  --agy-bar-fg: #f1f5f9;
  --agy-bar-muted: #94a3b8;
  --agy-pill-active: #1e293b;
  --agy-accent: #60a5fa;
  --agy-card-bg: #161922;
  --agy-drawer-bg: #111318;
}

/* Strip redundant web headers/chrome so Gemini & Antigravity feel like ONE native app */
header.gb_Pa, .gb_Pa, .gb_Fd, [data-ogsr-up], #product-controls-placeholder,
.boqOnegoogleliteOgbOneGoogleBar, .header-feedback-btn, .app-brand {
  display: none !important;
}

html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  position: relative !important;
  font-size: var(--agy-font-size, 14px) !important;
}

/* Pin Antigravity (<ga-root>) and Gemini (<chat-app-orchestrator#app-root>) strictly inside the viewport below the topbar */
ga-root,
ga-root.fullscreen,
body > app-root {
  display: block !important;
  position: absolute !important;
  top: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px)) !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  transform: translateZ(0) !important;
}

chat-app-orchestrator#app-root {
  display: flex !important;
  position: absolute !important;
  top: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px)) !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  transform: translateZ(0) !important;
}

chat-app {
  display: flex !important;
  position: relative !important;
  top: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

main.chat-app,
bard-sidenav-container,
bard-sidenav-content {
  flex: 1 1 auto !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}

ga-root #main-content.ga-content,
ga-remote-control,
ga-remote-control .app-container,
ga-remote-control .iframe-panel,
ga-remote-control iframe,
ga-remote-agents,
ga-remote-agents .theme-standalone,
ga-remote-agents .h-\\[100dvh\\] {
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}

/* Hide mobile-specific redundant headers while preserving desktop workstation toolbars */
ga-remote-agents .border-b.border-border,
ga-remote-agents div.shrink-0:has(> .border-b),
ga-remote-agents button[aria-label="Back to home"],
ga-remote-agents [data-testid="mobile-back-to-home"],
ga-remote-control button[aria-label="Back to home"],
ga-remote-control [data-testid="mobile-back-to-home"] {
  display: none !important;
}

/* Modern Web Guidance: Desktop PC adaptive topbar & layout rules */
html[data-agy-form-factor="desktop"] {
  --agy-topbar-h: 36px;
}

html[data-agy-form-factor="desktop"] #agy-unified-topbar {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  height: 36px !important;
  transform: none !important;
  border-radius: 0 !important;
  border: none !important;
  border-bottom: 1px solid var(--agy-bar-border) !important;
  background: light-dark(rgba(248, 249, 250, 0.96), rgba(18, 20, 24, 0.96)) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 0 12px !important;
  box-sizing: border-box !important;
  z-index: 2147483640 !important;
  overflow: hidden !important;
}

/* Ensure Desktop WebViews start strictly below the 36px App Bar with zero content overlap */
html[data-agy-form-factor="desktop"] ga-root,
html[data-agy-form-factor="desktop"] ga-root.fullscreen,
html[data-agy-form-factor="desktop"] body > app-root,
html[data-agy-form-factor="desktop"] chat-app-orchestrator#app-root {
  top: 36px !important;
  height: calc(100% - 36px) !important;
  max-height: calc(100% - 36px) !important;
}

/* Desktop Topbar Layout */
html[data-agy-form-factor="desktop"] .agy-top-left {
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
}

html[data-agy-form-factor="desktop"] .agy-top-left .agy-nav-icon-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  font-size: 13px !important;
  border-radius: 6px !important;
  padding: 0 !important;
}

html[data-agy-form-factor="desktop"] .agy-mode-switcher {
  display: inline-flex !important;
  align-items: center !important;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08)) !important;
  padding: 2px !important;
  border-radius: 999px !important;
  gap: 2px !important;
}

html[data-agy-form-factor="desktop"] .agy-mode-tab {
  padding: 2px 12px !important;
  height: 24px !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  border-radius: 999px !important;
}

html[data-agy-form-factor="desktop"] .agy-device-context-pill,
html[data-agy-form-factor="desktop"] .agy-subtab-group {
  display: none !important;
}

html[data-agy-form-factor="desktop"] .agy-top-right {
  display: inline-flex !important;
  align-items: center !important;
}

html[data-agy-form-factor="desktop"] .agy-top-right .agy-nav-icon-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  font-size: 12px !important;
  border-radius: 6px !important;
  padding: 0 !important;
}

@media (min-width: 768px) and (pointer: fine), (min-width: 1024px) {
  dialog.agy-unified-drawer {
    width: min(380px, 32vw);
    max-width: 420px;
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.35);
  }

  .agy-drawer-scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--agy-bar-border) transparent;
  }

  .agy-drawer-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .agy-drawer-scroll::-webkit-scrollbar-thumb {
    background: var(--agy-bar-border);
    border-radius: 999px;
  }

  .agy-mode-shortcut-hint {
    display: inline-block !important;
    font-size: 10px;
    opacity: 0.6;
    margin-left: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    vertical-align: middle;
  }
}

.agy-mode-shortcut-hint {
  display: none;
}

#agy-unified-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) 8px 0 8px;
  box-sizing: border-box;
  background: var(--agy-bar-bg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--agy-bar-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  z-index: 2147483644;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
  user-select: none;
  font-size: var(--agy-font-size, 14px);
  overflow: hidden;
}

.agy-top-left {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  z-index: 5;
}

.agy-mode-switcher {
  display: inline-flex;
  align-items: center;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
  padding: 2px 3px;
  border-radius: 999px;
  gap: 2px;
  flex: 0 0 auto;
  margin: 0 auto;
  z-index: 10;
}

.agy-top-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 auto;
  z-index: 5;
}

.agy-nav-icon-btn {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}

.agy-nav-icon-btn:hover {
  background: var(--agy-pill-active);
}

.agy-device-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 82px;
  height: 28px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  box-sizing: border-box;
}

.agy-device-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 0 1 auto;
  max-width: 48px;
  font-size: 11px;
}

.agy-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  flex: 0 0 7px;
}

.agy-status-dot.idle {
  background: #f59e0b;
}

.agy-status-dot.offline {
  background: #64748b;
}

.agy-dropdown-arrow {
  flex: 0 0 10px !important;
  width: 10px !important;
  height: 10px !important;
  color: var(--agy-bar-fg);
  opacity: 0.85;
  display: inline-block;
  vertical-align: middle;
}

.agy-mode-tab {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--agy-bar-muted);
  font-size: clamp(12px, var(--agy-font-size, 14px), 15px);
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease;
}

.agy-mode-tab[aria-selected="true"] {
  background: var(--agy-pill-active);
  color: var(--agy-bar-fg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
}

.agy-mode-badge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(59, 130, 246, 0.2);
  color: var(--agy-accent);
}

.agy-subtab-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.agy-subtab-btn {
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.agy-subtab-btn[aria-current="true"] {
  background: var(--agy-pill-active);
  border-color: var(--agy-bar-border);
  color: var(--agy-accent);
}

@media (max-width: 520px) {
  .agy-device-context-pill {
    max-width: 146px;
  }
  .agy-subtab-label-hide-sm {
    display: none;
  }
}

/* Unified App Navigation Drawer (<dialog>) - Conventional Mobile Best Practices */
dialog.agy-unified-drawer {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  bottom: 0 !important;
  z-index: 2147483647 !important;
  margin: 0;
  height: 100dvh;
  max-height: 100dvh;
  width: min(84vw, 320px);
  border: none;
  border-right: 1px solid var(--agy-bar-border);
  background: var(--agy-drawer-bg, #ffffff);
  color: var(--agy-bar-fg);
  padding: calc(14px + env(safe-area-inset-top, 0px)) 12px calc(14px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
  transform: translateX(-100%);
  transition: transform 220ms cubic-bezier(0.2, 0, 0, 1),
              display 220ms allow-discrete,
              overlay 220ms allow-discrete;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.28);
  touch-action: pan-y;
}

dialog.agy-unified-drawer[open] {
  display: flex !important;
  flex-direction: column;
  gap: 10px;
  transform: translateX(var(--agy-drawer-tx, 0px)) !important;
}

@starting-style {
  dialog.agy-unified-drawer[open] {
    transform: translateX(-100%) !important;
  }
}

dialog.agy-unified-drawer::backdrop {
  z-index: 2147483646 !important;
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

/* Drawer Profile Header */
.agy-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 10px;
  border-bottom: 1px solid var(--agy-bar-border);
}

.agy-drawer-user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agy-drawer-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4285f4, #9b51e0);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(66, 133, 244, 0.3);
}

.agy-drawer-user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.agy-drawer-user-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--agy-bar-fg);
  line-height: 1.2;
}

.agy-drawer-user-desc {
  font-size: 11px;
  color: var(--agy-bar-muted);
  line-height: 1.2;
  margin-top: 2px;
}

.agy-drawer-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 140ms ease;
}

.agy-drawer-close-btn:hover {
  background: var(--agy-pill-active);
}

/* Quick Action Launchers Grid */
.agy-drawer-action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.agy-drawer-action-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  box-sizing: border-box;
}

.agy-drawer-action-btn:hover,
.agy-drawer-action-btn:active {
  background: var(--agy-pill-active);
  border-color: var(--agy-accent);
}

.agy-drawer-action-btn.primary {
  background: light-dark(#eff6ff, #1e293b);
  border-color: rgba(59, 130, 246, 0.35);
}

/* Engine Mode Nav Tiles */
.agy-drawer-nav-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--agy-bar-border);
}

.agy-drawer-nav-tile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease;
  text-align: left;
  width: 100%;
  box-sizing: border-box;
}

.agy-drawer-nav-tile:hover {
  background: var(--agy-card-bg);
}

.agy-drawer-nav-tile[data-active="true"] {
  background: light-dark(#eff6ff, #1e293b);
  border-color: rgba(59, 130, 246, 0.25);
  font-weight: 700;
  color: var(--agy-accent);
}

.agy-drawer-nav-tile-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agy-drawer-badge-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  color: var(--agy-accent);
}

.agy-drawer-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 2px;
}

.agy-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agy-drawer-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--agy-bar-muted);
  padding: 4px 4px 2px;
  text-transform: uppercase;
}

.agy-drawer-section-count {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 999px;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
}

.agy-drawer-item-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agy-drawer-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  text-align: left;
  cursor: pointer;
  transition: all 120ms ease;
  width: 100%;
  box-sizing: border-box;
}

.agy-drawer-item:hover {
  background: var(--agy-card-bg);
  border-color: var(--agy-bar-border);
}

.agy-drawer-item[data-active="true"] {
  background: light-dark(#eff6ff, #1b2234);
  border-color: var(--agy-accent);
}

.agy-drawer-item-title {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--agy-bar-fg);
}

.agy-drawer-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--agy-bar-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agy-drawer-empty-hint {
  padding: 12px 8px;
  font-size: 11px;
  color: var(--agy-bar-muted);
  text-align: center;
}

/* Bottom Sticky Footer */
.agy-drawer-footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--agy-bar-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.agy-drawer-footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 140ms ease;
}

.agy-drawer-footer-btn:hover {
  background: var(--agy-pill-active);
}

.agy-drawer-footer-badge {
  font-size: 10px;
  color: var(--agy-bar-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
`;

export function navigateCrossEngineUrl(targetUrl: string): void {
  const isTargetGemini = targetUrl.startsWith('https://gemini.google.com/');
  const isCurrentGemini = window.location.hostname.includes('gemini.google.com');

  if (isTargetGemini === isCurrentGemini) {
    window.location.assign(targetUrl);
    return;
  }

  const tauriInvoke = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  }).__TAURI_INTERNALS__?.invoke;

  if (tauriInvoke) {
    void tauriInvoke('navigate_to_remote_session', { targetUrl });
    return;
  }

  const androidBridge = (window as unknown as {
    AndroidBridge?: { navigateToRemoteSession?: (url: string) => void };
  }).AndroidBridge;
  if (androidBridge?.navigateToRemoteSession) {
    androidBridge.navigateToRemoteSession(targetUrl);
    return;
  }

  window.location.assign(targetUrl);
}

export function switchAppEngine(target: 'gemini' | 'antigravity'): void {
  const targetUrl =
    target === 'gemini' ? 'https://gemini.google.com/app' : 'https://antigravity.google.com/remote';

  // 1. Android Native Bridge (Dual-WebView container)
  const androidBridge = (window as unknown as {
    AndroidBridge?: { switchEngine: (engine: string) => void };
  }).AndroidBridge;

  if (androidBridge && typeof androidBridge.switchEngine === 'function') {
    androidBridge.switchEngine(target);
    return;
  }

  if (window.AgyAndroidBridge?.switchEngine) {
    window.AgyAndroidBridge.switchEngine(target);
    return;
  }

  // 2. Desktop Tauri: Notify native backend to switch native windows
  const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
  if (tauriInvoke) {
    void tauriInvoke('switch_engine', { engine: target }).catch((err) => {
      console.warn('Native switch_engine failed, fallback to assign:', err);
      if (!window.location.href.startsWith(targetUrl)) {
        window.location.assign(targetUrl);
      }
    });
    return;
  }

  // 3. Fallback for pure browser / PWA
  if (!window.location.href.startsWith(targetUrl)) {
    window.location.assign(targetUrl);
  }
}

/**
 * Official Google Antigravity vector logo (100% Trusted-Types safe)
 */
export const createSvgAntigravityLogo = (size = 18): SVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 -960 960 960');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('agy-brand-logo-svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M482.04-859.61Q557.08-860 597-803.84t70,127.77q25.23,61.92 49.23,137.5t50.93,151.03q26.3,72.47 57.65,137.05T897-139.62q6.46,8.08 6.46,16.96T897-107.69t-16.35,6.38t-17.1-6.11q-76.71-64.2-122.32-140.01T646.48-376.6q-34.64-38.4-74.56-61.21t-89.63-22.42q-49.72-0.38-89.89,22.42T317.82-376.6q-49.36,53.37-94.98,129.18T100.52-107.42q-7.21,6.42-16.91,6.11t-16.54-6.58q-6.46-5.88-6.27-14.77t6.65-16.96q40.46-45.92 71.81-110.69t57.65-137.24Q223.85-463 247.85-538.3t49.23-137.77q29.18-71.36 69.55-127.64t115.41-55.9Zm-87.46,93.88q-31.27,48.5-53.88,102.27q-35.31,81.54-60.92,169.19T222.31-326.61q24.73-33.65 48.21-62.32t48.87-51.52q36.15-31.54 75.31-48.35t87.35-16.81t87.35,16.81t75.69,48.35q25,22.85 48.48,51.52t48.21,62.32q-31.85-80-57.46-167.65T623.77-663.46q-23-53.77-54.27-102.27t-87.46-48.5t-87.46,48.5Z'
  );
  svg.appendChild(path);
  return svg;
};

export function injectSharedNavBar(
  engineParam: 'gemini' | 'antigravity',
  onOpenSessionsSheet?: () => void
): void {
  // Dynamically verify engine based on current window location to prevent state desync
  const currentEngine: 'gemini' | 'antigravity' =
    typeof window !== 'undefined' && window.location.hostname.includes('gemini.google.com')
      ? 'gemini'
      : typeof window !== 'undefined' && window.location.hostname.includes('antigravity.google.com')
        ? 'antigravity'
        : engineParam;

  adoptStyleSheet('agy-shared-nav-styles', NAV_CSS);
  if (document.getElementById('agy-unified-topbar')) return;

  // Build Unified Navigation Drawer (<dialog>) - Conventional Mobile Architecture
  const drawer = el('dialog', {
    className: 'agy-unified-drawer',
    attrs: {
      'aria-label': 'Antigravity Unified Workspace & Sessions Drawer',
      'data-engine': currentEngine,
    },
  });

  const drawerAvatar = el('div', { className: 'agy-drawer-avatar' }, [createSvgAntigravityLogo(22)]);
  const drawerUserName = el('span', { className: 'agy-drawer-user-name', textContent: 'Antigravity' });
  const drawerUserDesc = el('span', { className: 'agy-drawer-user-desc', textContent: 'Google AI · Dual Engine' });

  const drawerUserInfo = el(
    'div',
    {
      className: 'agy-drawer-user-info',
      attrs: { title: '点击打开账号中心与设置' },
      style: 'cursor: pointer;',
      onClick: () => {
        drawer.close();
        openClaudeBottomSheet('Settings');
      },
    },
    [drawerAvatar, el('div', { className: 'agy-drawer-user-text' }, [drawerUserName, drawerUserDesc])]
  );

  const drawerProfile = el('div', { className: 'agy-drawer-header' }, [
    drawerUserInfo,
    el('button', {
      className: 'agy-drawer-close-btn',
      attrs: { type: 'button', 'aria-label': 'Close drawer' },
      textContent: '✕',
      onClick: () => drawer.close(),
    }),
  ]);

  // Quick Action Launchers Grid (✦ 新建对话 & ⚡ 新建代码)
  const actionGrid = el('div', { className: 'agy-drawer-action-grid' }, [
    el(
      'button',
      {
        className: 'agy-drawer-action-btn primary',
        attrs: { type: 'button' },
        onClick: () => {
          drawer.close();
          if (currentEngine === 'gemini') {
            window.location.assign('https://gemini.google.com/app');
          } else {
            switchAppEngine('gemini');
          }
        },
      },
      [
        el('span', { textContent: '✦', attrs: { style: 'color: #3b82f6; font-size: 15px;' } }),
        el('span', { textContent: '新建对话' }),
      ]
    ),
    el(
      'button',
      {
        className: 'agy-drawer-action-btn',
        attrs: { type: 'button' },
        onClick: () => {
          drawer.close();
          if (currentEngine === 'antigravity') {
            window.location.assign('https://antigravity.google.com/remote');
          } else {
            switchAppEngine('antigravity');
          }
        },
      },
      [
        el('span', { textContent: '⚡', attrs: { style: 'color: #f59e0b; font-size: 15px;' } }),
        el('span', { textContent: '新建代码' }),
      ]
    ),
  ]);

  // Core Engine Mode Navigation Tiles
  const navGroup = el('div', { className: 'agy-drawer-nav-group' }, [
    el(
      'button',
      {
        className: 'agy-drawer-nav-tile',
        attrs: {
          type: 'button',
          'data-active': currentEngine === 'gemini' ? 'true' : 'false',
        },
        onClick: () => {
          drawer.close();
          switchAppEngine('gemini');
        },
      },
      [
        el('div', { className: 'agy-drawer-nav-tile-left' }, [
          el('span', { textContent: '✦', attrs: { style: 'color: #3b82f6;' } }),
          el('span', { textContent: 'Gemini Chat' }),
        ]),
        ...(currentEngine === 'gemini'
          ? [el('span', { className: 'agy-drawer-badge-pill', textContent: '当前' })]
          : []),
      ]
    ),
    el(
      'button',
      {
        className: 'agy-drawer-nav-tile',
        attrs: {
          type: 'button',
          'data-active': currentEngine === 'antigravity' ? 'true' : 'false',
        },
        onClick: () => {
          drawer.close();
          switchAppEngine('antigravity');
        },
      },
      [
        el('div', { className: 'agy-drawer-nav-tile-left' }, [
          createSvgAntigravityLogo(17),
          el('span', { textContent: 'Antigravity Code' }),
        ]),
        ...(currentEngine === 'antigravity'
          ? [el('span', { className: 'agy-drawer-badge-pill', textContent: '当前' })]
          : []),
      ]
    ),
  ]);

  const drawerScroll = el('div', { className: 'agy-drawer-scroll' });

  // Bottom Sticky Footer
  const drawerThemeIcon = el('span', {
    textContent: getUnifiedTheme() === 'dark' ? '☀️' : '🌙',
  });
  const drawerThemeText = el('span', {
    textContent: getUnifiedTheme() === 'dark' ? '浅色' : '深色',
  });
  const drawerThemeBtn = el(
    'button',
    {
      className: 'agy-drawer-footer-btn',
      attrs: {
        type: 'button',
        title: '切换全局浅色/深色主题 (Chat & Code 统一同步)',
      },
      onClick: () => {
        toggleUnifiedTheme();
      },
    },
    [drawerThemeIcon, drawerThemeText]
  );

  const drawerRefreshBtn = el(
    'button',
    {
      className: 'agy-drawer-footer-btn',
      attrs: {
        type: 'button',
        title: '刷新并同步全部工作台与会话状态',
      },
      onClick: () => {
        void refreshAllMultiDeviceSessions();
        void pullStateFromNativeHost();
      },
    },
    [el('span', { textContent: '↻' }), el('span', { textContent: '同步' })]
  );

  const drawerSettingsBtn = el(
    'button',
    {
      className: 'agy-drawer-footer-btn',
      attrs: {
        type: 'button',
        title: '打开应用设置与账号中心',
      },
      onClick: () => {
        drawer.close();
        openClaudeBottomSheet('Settings');
      },
    },
    [el('span', { textContent: '⚙️' }), el('span', { textContent: '设置' })]
  );

  const drawerFooter = el('div', { className: 'agy-drawer-footer' }, [
    el('div', { attrs: { style: 'display:flex;gap:6px;align-items:center;' } }, [
      drawerThemeBtn,
      drawerRefreshBtn,
      drawerSettingsBtn,
    ]),
    el('span', { className: 'agy-drawer-footer-badge', textContent: 'v0.1.0' }),
  ]);

  const topbarThemeBtn = el('button', {
    className: 'agy-nav-icon-btn',
    textContent: getUnifiedTheme() === 'dark' ? '☀️' : '🌙',
    attrs: {
      type: 'button',
      title: '切换全局浅色/深色主题 (Chat & Code 统一同步)',
    },
    onClick: () => {
      toggleUnifiedTheme();
    },
  });

  subscribeUnifiedTheme((theme) => {
    const isDark = theme === 'dark';
    const icon = isDark ? '☀️' : '🌙';
    drawerThemeIcon.textContent = icon;
    drawerThemeText.textContent = isDark ? '浅色' : '深色';
    topbarThemeBtn.textContent = icon;
  });

  drawer.append(drawerProfile, actionGrid, navGroup, drawerScroll, drawerFooter);

  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.close();
  });

  // Claude Android App-grade Touch Swipe-to-Dismiss / Drag-to-Close gesture
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingDrawer = false;
  let isHorizontalGestureLocked = false;

  window.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (!drawer.open) return;
      const touch = e.touches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      isDraggingDrawer = false;
      isHorizontalGestureLocked = false;
    },
    { passive: true }
  );

  window.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!drawer.open) return;
      const touch = e.touches[0];
      if (!touch) return;

      const diffX = touch.clientX - touchStartX;
      const diffY = touch.clientY - touchStartY;

      if (!isHorizontalGestureLocked) {
        // Check if movement is primarily horizontal towards the left
        if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
          if (diffX < 0) {
            isHorizontalGestureLocked = true;
            isDraggingDrawer = true;
            drawer.style.transition = 'none';
          }
        } else if (Math.abs(diffY) > 8) {
          // Primarily vertical scroll inside the drawer list
          isHorizontalGestureLocked = true;
          isDraggingDrawer = false;
        }
      }

      if (isDraggingDrawer && diffX < 0) {
        if (e.cancelable) e.preventDefault();
        drawer.style.setProperty('--agy-drawer-tx', `${diffX}px`);
      }
    },
    { passive: false }
  );

  const handleTouchEnd = (e: TouchEvent) => {
    if (!drawer.open || !isDraggingDrawer) {
      isHorizontalGestureLocked = false;
      isDraggingDrawer = false;
      return;
    }
    isDraggingDrawer = false;
    isHorizontalGestureLocked = false;

    const touch = e.changedTouches[0];
    const diffX = touch ? touch.clientX - touchStartX : -100;
    const duration = Math.max(1, Date.now() - touchStartTime);
    const velocityX = diffX / duration; // px/ms

    // Threshold: dragged left by > 50px or flicked left
    const shouldClose = diffX < -50 || (diffX < -15 && velocityX < -0.35);

    drawer.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
    if (shouldClose) {
      drawer.style.setProperty('--agy-drawer-tx', '-100%');
      setTimeout(() => {
        if (drawer.open) drawer.close();
        drawer.style.removeProperty('--agy-drawer-tx');
        drawer.style.transition = '';
      }, 210);
    } else {
      drawer.style.setProperty('--agy-drawer-tx', '0px');
      setTimeout(() => {
        drawer.style.removeProperty('--agy-drawer-tx');
        drawer.style.transition = '';
      }, 210);
    }
  };

  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  drawer.addEventListener('close', () => {
    drawer.style.removeProperty('--agy-drawer-tx');
    drawer.style.transition = '';
    isDraggingDrawer = false;
    isHorizontalGestureLocked = false;
  });

  // Create crisp SVG chevron down (100% Trusted-Types safe)
  const createSvgChevronDown = (): SVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '11');
    svg.setAttribute('height', '11');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('agy-dropdown-arrow');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2.5 4.5L6 8L9.5 4.5');
    svg.appendChild(path);
    return svg;
  };

  // Top Bar Dynamic Elements
  const devicePillDot = el('span', { className: 'agy-status-dot' });
  const devicePillLabel = el('span', {
    className: 'agy-device-pill-label',
    textContent: currentEngine === 'gemini' ? '工作台' : '远程主机',
  });
  const deviceDropdownArrow = createSvgChevronDown();
  const deviceContextPill = el(
    'button',
    {
      className: 'agy-device-context-pill',
      attrs: {
        type: 'button',
        title: '切换工作台与会话 (Workstations & Sessions)',
        'aria-label': '切换工作台与会话',
      },
      onClick: () => {
        if (onOpenSessionsSheet) {
          onOpenSessionsSheet();
        } else {
          if (!drawer.open) {
          drawer.showModal();
        }
        }
      },
    },
    [devicePillDot, devicePillLabel, deviceDropdownArrow]
  );

  const sessionCountBadge = el('span', {
    className: 'agy-mode-badge',
    textContent: '1',
  });

  const rightSubtabsContainer = el('div', { className: 'agy-top-right' });

  const renderStateIntoUI = (state: UnifiedAppState) => {
    // Update Top Bar Device Context Pill & Session Count Badge
    const activeDev = state.devices.find((d) => d.uuid === state.currentInstanceUuid);
    if (currentEngine === 'antigravity' && activeDev) {
      const rawName = activeDev.displayName || '工作台';
      let shortName = '工作台';
      if (rawName.toLowerCase().includes('mini')) shortName = 'mini';
      else if (rawName.includes('-')) shortName = rawName.split('-')[0].slice(0, 4);
      else shortName = rawName.slice(0, 4);
      devicePillLabel.textContent = shortName;
      devicePillDot.className =
        activeDev.status === 'RUNNING'
          ? 'agy-status-dot'
          : activeDev.status === 'IDLE'
            ? 'agy-status-dot idle'
            : 'agy-status-dot offline';
    } else {
      const onlineCount = state.devices.filter((d) => d.status === 'RUNNING').length;
      devicePillLabel.textContent = onlineCount > 0 ? `${onlineCount}在线` : '工作台';
      devicePillDot.className = 'agy-status-dot';
    }

    sessionCountBadge.textContent = String(Math.max(1, state.sessions.length));

    // Update Right Cluster (Device Pill in Code mode + Optional Subtabs + Theme button)
    clearChildren(rightSubtabsContainer);
    if (currentEngine === 'antigravity') {
      rightSubtabsContainer.append(deviceContextPill);
      if (getShowSubtabs() && state.currentCascadeId) {
        const subtabs: Array<{ id: 'chat' | 'review' | 'terminal'; label: string; icon: string }> = [
          { id: 'chat', label: 'Chat', icon: '💬' },
          { id: 'review', label: 'Review', icon: '🔍' },
          { id: 'terminal', label: 'Term', icon: '>_ ' },
        ];
        const group = el('div', { className: 'agy-subtab-group' });
        for (const t of subtabs) {
          group.append(
            el(
              'button',
              {
                className: 'agy-subtab-btn',
                attrs: {
                  type: 'button',
                  'aria-current': state.currentTab === t.id ? 'true' : 'false',
                  title: `Switch session view to ${t.label}`,
                },
                onClick: () => {
                  openUnifiedSession(
                    {
                      deviceUuid: state.currentInstanceUuid || '__remote_conversations__',
                      cascadeId: state.currentCascadeId,
                      projectId: state.currentProjectId || 'default-cli-project',
                    },
                    t.id
                  );
                },
              },
              [
                el('span', { textContent: t.icon }),
                el('span', { className: 'agy-subtab-label-hide-sm', textContent: ` ${t.label}` }),
              ]
            )
          );
        }
        rightSubtabsContainer.append(group);
      }
    }
    rightSubtabsContainer.append(topbarThemeBtn);

    // Update User Profile Card in Drawer
    if (state.userProfile) {
      drawerUserName.textContent = state.userProfile.name || 'Google User';
      drawerUserDesc.textContent = state.userProfile.email || state.userProfile.tier || 'Google AI · Dual Engine';
      if (state.userProfile.avatarUrl) {
        clearChildren(drawerAvatar);
        drawerAvatar.style.background = 'transparent';
        drawerAvatar.appendChild(
          el('img', {
            attrs: { src: state.userProfile.avatarUrl, alt: 'avatar' },
            style: 'width:100%;height:100%;border-radius:50%;object-fit:cover;',
          })
        );
      }
    }

    // Rebuild Drawer Content (Multi-Device Sessions + Gemini Chats + Paired Workstations)
    clearChildren(drawerScroll);

    // 1. Unified Multi-Device Remote Sessions Section
    const sessionsSection = el('div', { className: 'agy-drawer-section' });
    sessionsSection.append(
      el('div', { className: 'agy-drawer-section-title' }, [
        el('span', { textContent: '⚡ 最近代码会话' }),
        el('span', {
          className: 'agy-drawer-section-count',
          textContent: `${state.sessions.length}`,
        }),
      ])
    );

    const sessionsList = el('div', { className: 'agy-drawer-item-list' });

    if (state.sessions.length === 0) {
      sessionsList.append(
        el('div', {
          className: 'agy-drawer-empty-hint',
          textContent: '暂无最近会话，点击下方配对工作台或上方新建',
        })
      );
    } else {
      for (const sess of state.sessions.slice(0, 5)) {
        const isCurrent =
          state.currentInstanceUuid === sess.deviceUuid &&
          state.currentCascadeId === sess.cascadeId;
        sessionsList.append(
          el(
            'button',
            {
              className: 'agy-drawer-item',
              attrs: {
                type: 'button',
                'data-active': isCurrent ? 'true' : 'false',
              },
              onClick: () => {
                drawer.close();
                openUnifiedSession(sess, sess.activeTab || 'chat');
              },
            },
            [
              el('div', { className: 'agy-drawer-item-title', textContent: sess.title }),
              el('div', { className: 'agy-drawer-item-meta' }, [
                el('span', {
                  className:
                    sess.deviceStatus === 'RUNNING'
                      ? 'agy-status-dot'
                      : sess.deviceStatus === 'IDLE'
                        ? 'agy-status-dot idle'
                        : 'agy-status-dot offline',
                }),
                el('span', { textContent: sess.deviceName }),
                el('span', { textContent: '·' }),
                el('span', { textContent: sess.projectId }),
                el('span', {
                  attrs: { style: 'margin-left:auto;font-size:10px;' },
                  textContent: sess.lastModifiedLabel,
                }),
              ]),
            ]
          )
        );
      }
    }
    sessionsSection.append(sessionsList);
    drawerScroll.append(sessionsSection);

    // 2. Synced Gemini Chat Threads Section (Accessible from BOTH Gemini and Antigravity!)
    if (state.geminiChats.length > 0) {
      const geminiSection = el('div', { className: 'agy-drawer-section' });
      geminiSection.append(
        el('div', { className: 'agy-drawer-section-title' }, [
          el('span', { textContent: '✦ 最近 Gemini 对话' }),
          el('span', {
            className: 'agy-drawer-section-count',
            textContent: `${state.geminiChats.length}`,
          }),
        ])
      );
      const geminiList = el('div', { className: 'agy-drawer-item-list' });
      for (const chat of state.geminiChats.slice(0, 5)) {
        geminiList.append(
          el(
            'button',
            {
              className: 'agy-drawer-item',
              attrs: { type: 'button' },
              onClick: () => {
                drawer.close();
                navigateCrossEngineUrl(chat.url);
              },
            },
            [
              el('div', { className: 'agy-drawer-item-title', textContent: chat.title }),
              el('div', { className: 'agy-drawer-item-meta' }, [
                el('span', { textContent: '💬 Gemini 网页对话' }),
              ]),
            ]
          )
        );
      }
      geminiSection.append(geminiList);
      drawerScroll.append(geminiSection);
    }

    // 3. Paired Remote Control Machines Section (Direct 1-tap connect)
    const devicesSection = el('div', { className: 'agy-drawer-section' });
    devicesSection.append(
      el('div', { className: 'agy-drawer-section-title' }, [
        el('span', { textContent: '💻 配对工作台' }),
        el('span', {
          className: 'agy-drawer-section-count',
          textContent: `${state.devices.length} 台`,
        }),
      ])
    );
    const devicesList = el('div', { className: 'agy-drawer-item-list' });
    for (const dev of state.devices) {
      const isCurrent = state.currentInstanceUuid === dev.uuid;
      devicesList.append(
        el(
          'button',
          {
            className: 'agy-drawer-item',
            attrs: {
              type: 'button',
              'data-active': isCurrent ? 'true' : 'false',
            },
            onClick: () => {
              drawer.close();
              const targetUrl =
                dev.uuid === '__remote_conversations__'
                  ? 'https://antigravity.google.com/remote'
                  : `https://antigravity.google.com/r/${encodeURIComponent(dev.uuid)}`;
              navigateCrossEngineUrl(targetUrl);
            },
          },
          [
            el(
              'div',
              {
                attrs: {
                  style:
                    'display:flex;align-items:center;justify-content:space-between;width:100%;',
                },
              },
              [
                el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px;' } }, [
                  el('span', {
                    className:
                      dev.status === 'RUNNING'
                        ? 'agy-status-dot'
                        : dev.status === 'IDLE'
                          ? 'agy-status-dot idle'
                          : 'agy-status-dot offline',
                  }),
                  el('span', {
                    className: 'agy-drawer-item-title',
                    textContent: `${dev.group === 'remoteConversations' ? '☁️ ' : '💻 '}${dev.displayName}`,
                  }),
                ]),
                el('span', {
                  attrs: {
                    style: `font-size:10px;font-weight:600;color:${
                      dev.status === 'RUNNING' ? '#22c55e' : '#94a3b8'
                    };`,
                  },
                  textContent: dev.status === 'RUNNING' ? '在线' : '离线',
                }),
              ]
            ),
          ]
        )
      );
    }
    devicesSection.append(devicesList);
    drawerScroll.append(devicesSection);
  };

  const topbar = el('nav', {
    id: 'agy-unified-topbar',
    attrs: {
      'aria-label': 'Antigravity Unified App Bar',
      'data-engine': currentEngine,
    },
  });

  const leftCluster = el('div', { className: 'agy-top-left' }, [
    el('button', {
      className: 'agy-nav-icon-btn',
      textContent: '☰',
      attrs: { type: 'button', 'aria-label': 'Open Unified App Drawer' },
      onClick: () => {
        void pullStateFromNativeHost();
        if (currentEngine === 'antigravity') {
          void refreshAllMultiDeviceSessions();
        }
        if (!drawer.open) {
          drawer.showModal();
        }
      },
    }),
  ]);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent || navigator.platform);
  const modKeyLabel = isMac ? '⌘' : 'Ctrl+';

  const switcher = el(
    'div',
    {
      className: 'agy-mode-switcher',
      attrs: { role: 'tablist', 'aria-label': 'App Engine Mode' },
    },
    [
      el(
        'button',
        {
          className: 'agy-mode-tab',
          attrs: {
            type: 'button',
            role: 'tab',
            title: `切换至 Gemini Chat (${modKeyLabel}1)`,
            'aria-selected': currentEngine === 'gemini' ? 'true' : 'false',
          },
          onClick: () => {
            switchAppEngine('gemini');
          },
        },
        [
          el('span', { textContent: '✦ Chat' }),
          el('span', { className: 'agy-mode-shortcut-hint', textContent: `${modKeyLabel}1` }),
        ]
      ),
      el(
        'button',
        {
          className: 'agy-mode-tab',
          attrs: {
            type: 'button',
            role: 'tab',
            title: `切换至 Antigravity Code Remote (${modKeyLabel}2)`,
            'aria-selected': currentEngine === 'antigravity' ? 'true' : 'false',
          },
          onClick: () => {
            switchAppEngine('antigravity');
          },
        },
        [
          el('span', { attrs: { style: 'display:inline-flex;align-items:center;gap:4px;' } }, [
            createSvgAntigravityLogo(13),
            el('span', { textContent: 'Code' }),
          ]),
          sessionCountBadge,
          el('span', { className: 'agy-mode-shortcut-hint', textContent: `${modKeyLabel}2` }),
        ]
      ),
    ]
  );

  // Desktop PC Global Keyboard Shortcuts
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && !e.shiftKey && !e.altKey) {
      if (e.key === '1') {
        e.preventDefault();
        if (currentEngine !== 'gemini') switchAppEngine('gemini');
      } else if (e.key === '2') {
        e.preventDefault();
        if (currentEngine !== 'antigravity') switchAppEngine('antigravity');
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (drawer.open) {
          drawer.close();
        } else {
          void pullStateFromNativeHost();
          if (currentEngine === 'antigravity') void refreshAllMultiDeviceSessions();
          drawer.showModal();
        }
      } else if (e.key === ',') {
        e.preventDefault();
        if (drawer.open) drawer.close();
        openClaudeBottomSheet('Settings');
      }
    } else if (isMeta && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      if (drawer.open) drawer.close();
      if (onOpenSessionsSheet) onOpenSessionsSheet();
      else openClaudeBottomSheet('DeviceSessions');
    }
  });

  topbar.append(leftCluster, switcher, rightSubtabsContainer);
  document.body.append(topbar, drawer);

  // Lock window scroll to prevent virtual keyboard / IME from pushing fixed topbar off-screen
  window.addEventListener(
    'scroll',
    () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    },
    { passive: true }
  );

  // Keep topbar pinned to visual viewport top when virtual keyboard pans or resizes viewport
  if (typeof window !== 'undefined' && window.visualViewport) {
    const syncWithVisualViewport = () => {
      const topbarEl = document.getElementById('agy-unified-topbar');
      if (topbarEl && window.visualViewport) {
        const offsetTop = Math.max(0, window.visualViewport.offsetTop || 0);
        topbarEl.style.transform = offsetTop > 0 ? `translate3d(0, ${offsetTop}px, 0)` : '';
      }
    };
    window.visualViewport.addEventListener('resize', syncWithVisualViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncWithVisualViewport, { passive: true });
  }

  subscribeUnifiedState(renderStateIntoUI);
  void pullStateFromNativeHost();
}

export const mountSharedNavigation = injectSharedNavBar;
